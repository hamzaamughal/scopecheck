import "server-only";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { ScopeImportError } from "./normalize.ts";

// Server-side fetch for user-supplied links, hardened against SSRF:
// public unicast addresses only (checked on the address actually connected to), ports 80/443,
// re-validated redirects, a hard timeout, a size cap, and a content-type allowlist.

export type SafeFetchOptions = {
  allowAddress?: (ip: string) => boolean; // tests only
  allowPort?: (port: number) => boolean;  // tests only
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};
export type SafeFetchResult = { body: string; contentType: string; finalUrl: string };

const ALLOWED_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];
const BLOCKED = "This link points to a private or local address and cannot be imported.";

export function isPublicAddress(ip: string): boolean {
  try { return ipaddr.process(ip).range() === "unicast"; } catch { return false; }
}

function guardedLookup(allow: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, family: options.family as number | undefined }, (error, addresses) => {
      if (error) return callback(error, "", 4);
      const list = addresses as dns.LookupAddress[];
      // Reject the host if ANY address is private, so a mixed record cannot be used to reach internal IPs.
      if (!list.length || list.some(entry => !allow(entry.address))) {
        return callback(Object.assign(new Error(BLOCKED), { code: "SCOPE_BLOCKED_ADDRESS" }), "", 4);
      }
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function charsetOf(contentType: string) {
  const match = /charset=([^;]+)/i.exec(contentType);
  try { return new TextDecoder(match?.[1].trim().replace(/"/g, "") || "utf-8"); } catch { return new TextDecoder("utf-8"); }
}

function requestOnce(url: URL, options: Required<SafeFetchOptions>, deadline: number):
  Promise<{ status: number; location?: string; contentType: string; body?: string }> {
  return new Promise((resolve, reject) => {
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!options.allowPort(port)) return reject(new ScopeImportError("Links on custom ports are not supported."));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // IP-literal hosts skip DNS lookup, so check them directly.
    if (ipaddr.isValid(host) && !options.allowAddress(host)) return reject(new ScopeImportError(BLOCKED));

    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new ScopeImportError("The link took too long to respond."));
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, {
      method: "GET",
      lookup: guardedLookup(options.allowAddress),
      headers: { "User-Agent": "ScopeCheckBot/1.0 (+https://scopecheck.hamzaabubakar.dev)", Accept: "text/html,text/plain;q=0.9", "Accept-Encoding": "identity" },
      timeout: remaining,
    }, response => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400) {
        response.resume();
        return resolve({ status, location: response.headers.location, contentType });
      }
      if (status !== 200) { response.resume(); return reject(new ScopeImportError(status === 401 || status === 403 ? "This link is not public. Share it as “Anyone with the link” or download it and upload the file." : `The page returned an error (status ${status}).`)); }
      if (!ALLOWED_TYPES.some(type => contentType.startsWith(type))) {
        response.resume();
        return reject(new ScopeImportError(contentType.startsWith("application/pdf") ? "This link is a PDF file. Download it and use “Upload file” instead." : "This link is not a web page or text document."));
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) { request.destroy(new ScopeImportError("This page is too large to import (over 2 MB).")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, contentType, body: charsetOf(contentType).decode(Buffer.concat(chunks)) }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new ScopeImportError("The link took too long to respond.")));
    request.on("error", error => reject(
      error instanceof ScopeImportError ? error
        : (error as { code?: string }).code === "SCOPE_BLOCKED_ADDRESS" ? new ScopeImportError(BLOCKED)
        : (error as { code?: string }).code === "ENOTFOUND" ? new ScopeImportError("That website could not be found. Check the link.")
        : new ScopeImportError("Could not reach that link.")));
    request.end();
  });
}

export async function safeFetchText(start: URL, overrides: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const options: Required<SafeFetchOptions> = {
    allowAddress: isPublicAddress, allowPort: port => port === 80 || port === 443,
    timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3, ...overrides,
  };
  const deadline = Date.now() + options.timeoutMs;
  let url = start;
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ScopeImportError("Only http and https links are supported.");
    if (url.username || url.password) throw new ScopeImportError("Links with a username or password are not supported.");
    const result = await requestOnce(url, options, deadline);
    if (result.location === undefined && result.body !== undefined) return { body: result.body, contentType: result.contentType, finalUrl: url.toString() };
    if (!result.location) throw new ScopeImportError("The link redirected without a destination.");
    url = new URL(result.location, url); // every hop is re-validated by the next iteration
  }
  throw new ScopeImportError("The link redirected too many times.");
}
