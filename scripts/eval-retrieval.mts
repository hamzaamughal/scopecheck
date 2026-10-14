// Retrieval eval: does hybrid search put the right document section in the top k for a client request?
// Runs the production chunker and the production search SQL inside a temporary schema, then ROLLS BACK.
//
//   npm run eval:retrieval              offline: deterministic local embeddings, no network, no cost
//   npm run eval:retrieval -- --live    real text-embedding-3-small (needs OPENAI_API_KEY; ~20k tokens, < $0.001)
//
// Reports recall@k and MRR for keyword-only, vector-only, and hybrid (RRF) search.
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";
import { applyMigrations } from "./lib/migrations.mjs";
import { chunkDocument } from "../src/lib/rag/chunk.ts";
import { orQueryTerms, reciprocalRankFusion } from "../src/lib/rag/rrf.ts";
import { KEYWORD_SEARCH_SQL, VECTOR_SEARCH_SQL } from "../src/lib/rag/search-sql.ts";

nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)));
const live = process.argv.includes("--live");
if (!live) process.env.SCOPECHECK_FAKE_AI = "1";
const { embedTexts, toVectorLiteral } = await import("../src/lib/rag/embeddings.ts");

// ---------- Corpus: one project's supporting documents (fictional dental clinic website) ----------
const filler = (topic: string, n: number) => Array.from({ length: n }, (_, i) =>
  `${topic} item ${i + 1}: we reviewed the layout of section ${i + 1}, adjusted spacing and headings, and confirmed the copy with the clinic manager before moving on.`).join("\n\n");

const documents = [
  { kind: "proposal", title: "Proposal v3", text: [
    "[Page 1]", "1. Overview", "Harbor Dental needs a modern website with six pages: Home, About, Services, Team, Contact, and Book a visit.",
    "[Page 2]", "2. Content management", "Editors can update text and photos through the CMS. Training is a single 60-minute video call.",
    filler("Design", 40),
    "[Page 3]", "3. Search engine optimisation", "Basic on-page SEO: titles, meta descriptions, and an XML sitemap. Ongoing SEO campaigns and link building are not part of this proposal.",
    "[Page 4]", "4. Online booking", "The Book a visit page embeds the clinic's existing Dentrix booking widget. Building a custom scheduling system is out of scope.",
    "[Page 5]", "5. Hosting", "We set up hosting on Vercel for the first year. Domain renewals stay with the clinic.",
    "[Page 6]", "6. Revisions", "Two rounds of design revisions are included per page template.",
    filler("Timeline", 45),
  ].join("\n\n") },
  { kind: "email", title: "Email thread with Dana (clinic manager)", text: [
    "Dana, Mar 3: Could we also have the site in Spanish? Many of our patients prefer it.",
    "Reply, Mar 3: A Spanish version would need translated copy and a language switcher; it is not in the proposal, so I'll send a separate quote.",
    filler("Photo review", 30),
    "Dana, Mar 9: Our front desk wants a little chat bubble so people can message us from the site.",
    "Reply, Mar 9: A live chat widget like Intercom or Tidio can be embedded, but setup and monthly plan costs are not included.",
    "Dana, Mar 12: Can people sign up for our monthly newsletter on the homepage?",
    "Reply, Mar 12: A Mailchimp signup form on the homepage is easy to add; we agreed to include it at no extra cost.",
    filler("Copy edit", 30),
    "Dana, Mar 20: Please move our old blog posts from WordPress too.",
    "Reply, Mar 20: Migrating the 140 WordPress blog posts was not planned; I estimated 8 hours for the import and redirects.",
  ].join("\n\n") },
  { kind: "notes", title: "Kickoff meeting notes", text: [
    "[Page 1]", "Attendees: Dana, Dr. Lee, Hamza.",
    "Patient portal: Dr. Lee asked if patients could log in to see appointment history and invoices. Agreed this is phase two and will be quoted separately.",
    filler("Discussion", 35),
    "[Page 2]", "Insurance: the new-patient insurance form will be a downloadable PDF on the Services page.",
    "Reviews: show the clinic's Google reviews in a carousel on the homepage using an embed.",
    "Cookie consent: a simple cookie banner is required because of the analytics script.",
    "Performance: mobile pages should load in under 2.5 seconds on 4G.",
    filler("Action items", 35),
  ].join("\n\n") },
  { kind: "other", title: "Support and maintenance call", text: [
    "Maintenance retainer: the clinic asked about monthly updates after launch. A retainer of 4 hours per month was discussed but not agreed.",
    "Backups: Vercel keeps deployment history; the CMS content is backed up daily by the CMS provider.",
    "Email accounts: setting up staff email addresses on Google Workspace is the clinic's IT provider's job.",
    filler("Support", 40),
    "Accessibility: target WCAG 2.2 AA for colour contrast, keyboard navigation, and alt text.",
  ].join("\n\n") },
] as const;

// ---------- Cases: client requests in their own words → the section that should be retrieved ----------
const cases: { query: string; expect: string }[] = [
  { query: "Can patients log in and see their past appointments and bills?", expect: "Patient portal" },
  { query: "Could the website be translated into Spanish?", expect: "A Spanish version would need translated copy" },
  { query: "We'd like a chat window so visitors can message the front desk", expect: "A live chat widget like Intercom" },
  { query: "Add a newsletter signup on the home page please", expect: "A Mailchimp signup form" },
  { query: "Please bring over our old WordPress blog articles", expect: "Migrating the 140 WordPress blog posts" },
  { query: "Can you build our own appointment scheduling system?", expect: "Building a custom scheduling system is out of scope" },
  { query: "Will you keep doing SEO every month to rank higher?", expect: "Ongoing SEO campaigns and link building" },
  { query: "Who renews our domain name?", expect: "Domain renewals stay with the clinic" },
  { query: "Can we get another round of design changes on the Services template?", expect: "Two rounds of design revisions" },
  { query: "Put our Google reviews on the homepage", expect: "Google reviews in a carousel" },
  { query: "We need the insurance form available to download", expect: "insurance form will be a downloadable PDF" },
  { query: "Do we need a cookie popup?", expect: "cookie banner is required" },
  { query: "The mobile site must be fast", expect: "mobile pages should load in under 2.5 seconds" },
  { query: "Can you do monthly updates after launch?", expect: "A retainer of 4 hours per month" },
  { query: "Set up email addresses for our staff", expect: "staff email addresses on Google Workspace" },
  { query: "Is the site accessible for screen reader users?", expect: "WCAG 2.2 AA" },
  { query: "How do we back up the website content?", expect: "backed up daily by the CMS provider" },
  { query: "Can our team get more training on editing pages?", expect: "Training is a single 60-minute video call" },
  { query: "Where will the website be hosted?", expect: "hosting on Vercel for the first year" },
  { query: "Can we embed the Dentrix booking tool?", expect: "embeds the clinic's existing Dentrix booking widget" },
];

const K = [1, 3, 5, 8];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
const schema = `scopecheck_eval_${randomBytes(4).toString("hex")}`;
try {
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET LOCAL search_path TO ${schema}`);
  await applyMigrations(client, () => {});
  const { rows: [project] } = await client.query("INSERT INTO projects (name, scope) VALUES ('Eval', 'Six pages.') RETURNING id");

  const allChunks: { id: string; text: string }[] = [];
  const texts: string[] = []; const ids: string[] = [];
  const model = live ? "text-embedding-3-small" : "fake-hashed-bow";
  for (const doc of documents) {
    const { rows: [row] } = await client.query(
      `INSERT INTO project_documents (project_id, kind, title, text, content_hash, index_status, embedding_model)
       VALUES ($1, $2, $3, $4, repeat('0', 64), 'ready', $5) RETURNING id`, [project.id, doc.kind, doc.title, doc.text, model]);
    for (const chunk of chunkDocument(doc.text)) {
      const { rows: [c] } = await client.query(
        "INSERT INTO document_chunks (document_id, project_id, ordinal, page, heading, text) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [row.id, project.id, chunk.ordinal, chunk.page, chunk.heading, chunk.text]);
      allChunks.push({ id: c.id, text: chunk.text });
      ids.push(c.id); texts.push(chunk.heading && !chunk.text.startsWith(chunk.heading) ? `${chunk.heading}\n${chunk.text}` : chunk.text);
    }
  }
  const { vectors, tokens } = await embedTexts(texts, 60_000);
  for (let i = 0; i < ids.length; i++) await client.query("UPDATE document_chunks SET embedding = $2::public.vector WHERE id = $1", [ids[i], toVectorLiteral(vectors[i])]);
  const { vectors: queryVectors, tokens: queryTokens } = await embedTexts(cases.map(c => c.query), 60_000);

  const stats = { keyword: { hits: K.map(() => 0), rr: 0 }, vector: { hits: K.map(() => 0), rr: 0 }, hybrid: { hits: K.map(() => 0), rr: 0 } };
  const misses: string[] = [];
  for (const [index, item] of cases.entries()) {
    const targets = new Set(allChunks.filter(c => c.text.includes(item.expect)).map(c => c.id));
    if (!targets.size) throw new Error(`Fixture error: no chunk contains "${item.expect}"`);
    const keyword = (await client.query(KEYWORD_SEARCH_SQL, [project.id, orQueryTerms(item.query), 20])).rows.map(r => r.id as string);
    const vector = (await client.query(VECTOR_SEARCH_SQL, [project.id, toVectorLiteral(queryVectors[index]), model, 20])).rows.map(r => r.id as string);
    const hybrid = reciprocalRankFusion([keyword, vector], 20).map(r => r.id);
    for (const [name, list] of Object.entries({ keyword, vector, hybrid }) as [keyof typeof stats, string[]][]) {
      const rank = list.findIndex(id => targets.has(id)) + 1;
      K.forEach((k, i) => { if (rank > 0 && rank <= k) stats[name].hits[i]++; });
      if (rank > 0) stats[name].rr += 1 / rank;
      if (name === "hybrid" && (rank === 0 || rank > 5)) misses.push(`  rank ${rank || "—"}: ${item.query}`);
    }
  }
  const pct = (n: number) => `${Math.round((100 * n) / cases.length)}%`.padStart(5);
  console.log(`\nRetrieval eval · ${cases.length} cases · ${allChunks.length} chunks in ${documents.length} documents · embeddings: ${live ? "text-embedding-3-small (live)" : "local hashed bag-of-words (offline)"}`);
  console.log(`method    ${K.map(k => `R@${k}`.padStart(5)).join(" ")}    MRR`);
  for (const [name, s] of Object.entries(stats)) console.log(`${name.padEnd(9)} ${s.hits.map(pct).join(" ")}   ${(s.rr / cases.length).toFixed(2)}`);
  if (misses.length) console.log(`\nHybrid misses outside top 5:\n${misses.join("\n")}`);
  if (live) console.log(`\nEmbedding tokens used: ${tokens + queryTokens}`);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}
