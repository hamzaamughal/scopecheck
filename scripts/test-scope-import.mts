// Offline tests for scope import helpers and the SSRF-safe fetch. No AI calls, no external network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { normalizeText, joinPages, pageOfQuote, contentHash, assertImportable, diffLines, SCOPE_MAX_CHARS } from "../src/lib/scope-import/normalize.ts";
import { prepareLinkUrl } from "../src/lib/scope-import/link-url.ts";
import { safeFetchText, isPublicAddress } from "../src/lib/scope-import/safe-fetch.ts";
import { htmlToText } from "../src/lib/scope-import/html-to-text.ts";

test("normalizes whitespace and keeps paragraphs", () => {
  assert.equal(normalizeText("  A  b \r\n\r\n\r\n\nC\t\td  "), "A b\n\nC d");
});

test("page markers survive edits and map quotes to pages", () => {
  const scope = joinPages(["Intro text", "", "Two revisions are included.", "User accounts are excluded."]);
  assert.ok(scope.startsWith("[Page 1]\nIntro text"));
  assert.ok(!scope.includes("[Page 2]"), "empty pages are skipped");
  assert.equal(pageOfQuote(scope, "Two revisions are included."), 3);
  assert.equal(pageOfQuote(scope, "User accounts are excluded."), 4);
  const edited = "Note added later.\n" + scope.replace("Intro text", "Intro text, revised");
  assert.equal(pageOfQuote(edited, "User accounts are excluded."), 4);
  assert.equal(pageOfQuote(edited, "Note added later."), null);
  assert.equal(pageOfQuote(scope, "not present"), null);
});

test("hash matches PostgreSQL sha256 of UTF-8 text", async () => {
  assert.equal(await contentHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("length limit", () => {
  assert.throws(() => assertImportable(""), /No readable text/);
  assert.throws(() => assertImportable("x".repeat(SCOPE_MAX_CHARS + 1)), /limit is 60,000/);
  assert.doesNotThrow(() => assertImportable("x".repeat(SCOPE_MAX_CHARS)));
});

test("line diff", () => {
  const d = diffLines("a\nb\nc", "a\nc\nd");
  assert.deepEqual(d, [{ type: "same", text: "a" }, { type: "removed", text: "b" }, { type: "same", text: "c" }, { type: "added", text: "d" }]);
});

test("link URL validation and Google Docs rewrite", () => {
  assert.equal(prepareLinkUrl("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit?usp=sharing").fetchUrl.toString(),
    "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/export?format=txt");
  assert.throws(() => prepareLinkUrl("ftp://example.com/a"), /http and https/);
  assert.throws(() => prepareLinkUrl("file:///etc/passwd"), /http and https/);
  assert.throws(() => prepareLinkUrl("https://user:pass@example.com"), /username or password/);
  assert.throws(() => prepareLinkUrl("https://example.com:8443/x"), /custom ports/);
  assert.throws(() => prepareLinkUrl("https://docs.google.com/spreadsheets/d/abc"), /Only Google Docs/);
  assert.throws(() => prepareLinkUrl("not a url"), /full link/);
  assert.ok(prepareLinkUrl("https://acme.notion.site/SOW-123").hint);
});

test("address classification", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "2002:a00:1::"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["8.8.8.8", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("safe fetch blocks private targets with production settings", async () => {
  for (const target of ["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://10.0.0.5/"]) {
    await assert.rejects(safeFetchText(new URL(target), { timeoutMs: 3000 }), /private or local address/, target);
  }
});

test("safe fetch: redirects, size, type, timeout (local server, test-only allowlist)", async () => {
  let port = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<p>Scope text</p>"); }
    else if (req.url === "/to-private") { res.writeHead(302, { location: `http://10.0.0.5:${port}/secret` }); res.end(); }
    else if (req.url === "/to-ok") { res.writeHead(301, { location: "/ok" }); res.end(); }
    else if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); }
    else if (req.url === "/big") { res.writeHead(200, { "content-type": "text/plain" }); res.end("x".repeat(3 * 1024 * 1024)); }
    else if (req.url === "/pdf") { res.writeHead(200, { "content-type": "application/pdf" }); res.end("%PDF"); }
    else if (req.url === "/private") { res.writeHead(403); res.end(); }
    else if (req.url === "/slow") { setTimeout(() => { res.writeHead(200, { "content-type": "text/plain" }); res.end("late"); }, 2000); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const local = { allowAddress: (ip: string) => ip === "127.0.0.1", allowPort: (p: number) => p === port };
  try {
    const ok = await safeFetchText(new URL(`${base}/to-ok`), local);
    assert.equal(ok.body, "<p>Scope text</p>"); assert.equal(ok.finalUrl, `${base}/ok`);
    await assert.rejects(safeFetchText(new URL(`${base}/to-private`), local), /private or local address/);
    await assert.rejects(safeFetchText(new URL(`${base}/loop`), local), /too many times/);
    await assert.rejects(safeFetchText(new URL(`${base}/big`), local), /too large/);
    await assert.rejects(safeFetchText(new URL(`${base}/pdf`), local), /PDF file/);
    await assert.rejects(safeFetchText(new URL(`${base}/private`), local), /not public/);
    await assert.rejects(safeFetchText(new URL(`${base}/slow`), { ...local, timeoutMs: 500 }), /too long/);
  } finally { server.close(); }
});

test("HTML to text keeps structure and drops scripts and navigation", () => {
  const { title, text } = htmlToText(`<html><head><title>SOW</title><script>steal()</script></head><body><nav>Menu</nav><article><h1>Statement of Work</h1><p>We will build a five-page website for Acme Studio including design and development work.</p><ul><li>Two revisions</li><li>Contact form</li></ul><p>User accounts and online payments are not included in this agreement at all.</p></article></body></html>`);
  assert.equal(title, "SOW");
  assert.ok(text.includes("- Two revisions\n- Contact form"));
  assert.ok(!text.includes("steal") && !text.includes("Menu"));
});
