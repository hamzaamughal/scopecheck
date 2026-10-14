import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { getProject } from "@/lib/project-repository";
import { formatMoney, listChangeOrders, listScopeVersions } from "@/lib/workflow-repository";
import { pageOfQuote } from "@/lib/scope-import/normalize";
import { decisionLabels } from "@/lib/request-view";
import PrintButton from "@/components/print-button";
import type { RequestDecision } from "@/types/request";

export const metadata: Metadata = { title: "Decision log — ScopeCheck", robots: { index: false } };

type RequestRow = {
  id: string; title: string; description: string; decision: RequestDecision | null; decisionNote: string | null; decidedAt: Date | null; createdAt: Date;
  suggestion: RequestDecision | null; evidence: string[] | null; assessedAt: Date | null;
  citations: { quote: string; binding: boolean; documentTitle: string | null; page: number | null }[] | null;
};

const date = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const reasonLabels = { initial: "Created", edit: "Edited", import: "Imported", link_update: "Updated from link", change_order: "Change order accepted" } as const;

// Printable decision log: the browser's "Save as PDF" produces the file, with selectable text.
export default async function ReportPage({ params }: PageProps<"/projects/[projectId]/report">) {
  const user = await getCurrentUser(await headers());
  if (!user) redirect("/login");
  if (!user.emailVerified) redirect("/verify-email");
  const { projectId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) notFound();

  const project = await getProject(db, user.id, projectId);
  if (!project) notFound();
  const [requests, changeOrders, versions] = await Promise.all([
    db.query<RequestRow>(
      `SELECT r.id, r.title, r.description, r.decision, r.decision_note AS "decisionNote", r.decided_at AS "decidedAt", r.created_at AS "createdAt",
         a.output->>'suggestedDecision' AS suggestion, ARRAY(SELECT jsonb_array_elements_text(a.output->'evidence')) AS evidence, a.output->'citations' AS citations, a.created_at AS "assessedAt"
       FROM requests r
       LEFT JOIN LATERAL (SELECT output, created_at FROM assessments WHERE request_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1) a ON true
       WHERE r.project_id = $1 ORDER BY r.created_at ASC, r.id ASC`, [projectId]).then(result => result.rows),
    listChangeOrders(user.id, projectId).then(rows => rows ?? []),
    listScopeVersions(user.id, projectId).then(rows => rows ?? []),
  ]);

  const counts = { included: 0, extra_work: 0, needs_clarification: 0, open: 0 };
  for (const request of requests) counts[request.decision ?? "open"]++;
  const accepted = changeOrders.filter(order => order.status === "accepted");
  const totals = Object.entries(accepted.reduce<Record<string, number>>((sum, order) => {
    if (order.amountCents !== null) sum[order.currency] = (sum[order.currency] ?? 0) + order.amountCents;
    return sum;
  }, {}));

  return <main className="report">
    <div className="report-toolbar no-print"><Link href="/" className="back-link">← Back to workspace</Link><PrintButton/></div>
    <header className="report-header">
      <p className="eyebrow">Decision log</p>
      <h1>{project.name}</h1>
      <dl className="report-meta">
        <div><dt>Client</dt><dd>{project.clientName || "—"}</dd></div>
        <div><dt>Prepared by</dt><dd>{user.name}</dd></div>
        <div><dt>Generated</dt><dd>{date(new Date())}</dd></div>
        <div><dt>Scope version</dt><dd>v{versions[0]?.version ?? 1}{project.source ? ` · from ${project.source.label}` : ""}</dd></div>
      </dl>
    </header>

    <section className="report-summary" aria-label="Summary">
      <div><strong>{requests.length}</strong><span>Requests</span></div>
      <div><strong>{counts.included}</strong><span>Included</span></div>
      <div><strong>{counts.extra_work}</strong><span>Extra work</span></div>
      <div><strong>{counts.needs_clarification}</strong><span>Needs clarification</span></div>
      <div><strong>{counts.open}</strong><span>Not decided</span></div>
    </section>

    <section className="report-section">
      <h2>Requests and decisions</h2>
      {requests.length === 0 && <p className="report-muted">No requests recorded yet.</p>}
      {requests.map((request, index) => <article key={request.id} className="report-request">
        <div className="report-request-head"><h3>{index + 1}. {request.title}</h3><span className={`report-decision ${request.decision ?? "open"}`}>{request.decision ? decisionLabels[request.decision] : "Not decided"}</span></div>
        <p className="report-small">Received {date(request.createdAt)}{request.decidedAt ? ` · Decided ${date(request.decidedAt)}` : ""}</p>
        <blockquote className="report-client">{request.description}</blockquote>
        {request.decisionNote && <p><strong>Note:</strong> {request.decisionNote}</p>}
        {request.suggestion && <div className="report-ai">
          <p className="report-small">AI suggestion ({date(request.assessedAt)}): {decisionLabels[request.suggestion]}. Reviewed by a person; the decision above is final.</p>
          {(request.evidence ?? []).map((quote, i) => { const page = pageOfQuote(project.scope, quote); return <p key={i} className="report-quote">“{quote}”{page !== null ? ` (page ${page})` : ""}</p>; })}
          {(request.citations ?? []).filter(c => !c.binding).map((c, i) => <p key={`c${i}`} className="report-quote">Context: “{c.quote}” ({c.documentTitle}{c.page ? `, page ${c.page}` : ""})</p>)}
        </div>}
      </article>)}
    </section>

    <section className="report-section">
      <h2>Change orders</h2>
      {changeOrders.length === 0 ? <p className="report-muted">No change orders.</p> : <table className="report-table">
        <thead><tr><th>#</th><th>Change</th><th>Estimate</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>{[...changeOrders].reverse().map(order => <tr key={order.id}>
          <td>{order.number}</td>
          <td><strong>{order.title}</strong><br/><span className="report-small">{order.description}</span></td>
          <td>{[order.hours !== null ? `${order.hours} h` : "", order.amountCents !== null ? formatMoney(order.amountCents, order.currency) : ""].filter(Boolean).join(" · ") || "—"}</td>
          <td className={`report-status ${order.status}`}>{order.status[0].toUpperCase() + order.status.slice(1)}</td>
          <td>{date(order.decidedAt ?? order.createdAt)}</td>
        </tr>)}</tbody>
      </table>}
      {totals.length > 0 && <p className="report-total">Accepted total: {totals.map(([currency, cents]) => formatMoney(cents, currency)).join(" + ")}</p>}
    </section>

    <section className="report-section">
      <h2>Scope history</h2>
      <ol className="report-versions">{versions.map(version => <li key={version.id}><strong>v{version.version}</strong> · {reasonLabels[version.reason]}{version.changeOrderNumber ? ` #${version.changeOrderNumber}` : ""} · {date(version.createdAt)}</li>)}</ol>
    </section>

    <section className="report-section report-scope">
      <h2>Agreed scope (current version)</h2>
      <div className="report-scope-text">{project.scope}</div>
    </section>
    <footer className="report-footer">Generated with ScopeCheck. AI suggestions are advisory; decisions were recorded by {user.name}.</footer>
  </main>;
}
