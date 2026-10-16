import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-session";
import { furthestStage, getAdminStats, isAdmin, STAGES } from "@/lib/admin-stats";

export const metadata: Metadata = { title: "Stats — ScopeCheck", robots: { index: false, follow: false } };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const ago = (date: Date | null) => {
  if (!date) return "—";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
};

// Owner-only usage page. Anyone else (including signed-out visitors) gets a 404, so the page's existence is not revealed.
export default async function AdminPage() {
  const user = await getCurrentUser(await headers());
  if (!user || !user.emailVerified || !isAdmin(user.email)) notFound();

  const stats = await getAdminStats();
  const maxDaily = Math.max(1, ...stats.daily.map(day => day.signups));
  const top = Math.max(1, stats.funnel[0].count);
  const stageLabel = Object.fromEntries(STAGES.map(stage => [stage.key, stage.label]));

  return <main className="admin">
    <div className="admin-head">
      <div><p className="eyebrow">Owner only</p><h1>ScopeCheck stats</h1>
        <p className="admin-note">Real users only: your own, test, and demo accounts are left out. Visitor numbers (views, countries, referrers) are in Vercel → Analytics.</p></div>
      <Link href="/" className="button secondary small">Back to workspace</Link>
    </div>

    <section className="admin-cards" aria-label="Totals">
      {[["Users", stats.totals.users], ["New in last 7 days", stats.totals.last7], ["New in last 30 days", stats.totals.last30],
        ["Active in last 7 days", stats.totals.activeLast7], ["AI checks run", stats.totals.aiChecks], ["Documents added", stats.totals.documents]]
        .map(([label, value]) => <div key={label} className="admin-card"><strong>{value}</strong><span>{label}</span></div>)}
    </section>
    <p className="admin-note">Today: {stats.today.aiAttempts} AI attempts used · {stats.today.embeddingTokens.toLocaleString("en")} embedding tokens.</p>

    <div className="admin-grid">
      <section className="admin-panel">
        <h2>Sign-ups, last 30 days</h2>
        <div className="admin-bars" role="img" aria-label={`Sign-ups per day; ${stats.totals.last30} in total`}>
          {stats.daily.map(day => <div key={day.day} className="admin-bar" title={`${day.day}: ${day.signups}`}>
            <span style={{ height: `${(day.signups / maxDaily) * 100}%` }}/>
          </div>)}
        </div>
        <div className="admin-axis"><span>{stats.daily[0]?.day}</span><span>Today</span></div>
      </section>

      <section className="admin-panel">
        <h2>How far people get</h2>
        <ul className="admin-funnel">
          {stats.funnel.map(stage => <li key={stage.key}>
            <span className="admin-funnel-label">{stage.label}</span>
            <span className="admin-funnel-track"><span style={{ width: `${(stage.count / top) * 100}%` }}/></span>
            <span className="admin-funnel-count">{stage.count}{stats.funnel[0].count ? ` · ${Math.round((stage.count / top) * 100)}%` : ""}</span>
          </li>)}
        </ul>
      </section>
    </div>

    <section className="admin-panel">
      <h2>Users ({stats.users.length})</h2>
      {stats.users.length === 0 ? <p className="admin-note">No real sign-ups yet.</p> :
      <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>User</th><th>Joined</th><th>Sign-in</th><th>Furthest step</th><th>Projects</th><th>Requests</th><th>AI checks</th><th>Docs</th><th>Change orders</th><th>Last active</th></tr></thead>
        <tbody>{stats.users.map(row => <tr key={row.id}>
          <td><strong>{row.name || "—"}</strong><span>{row.email}{!row.verified && " · unverified"}</span></td>
          <td>{dateFmt.format(row.joinedAt)}</td>
          <td>{row.method}</td>
          <td><span className={`admin-stage ${furthestStage(row)}`}>{stageLabel[furthestStage(row)]}</span></td>
          <td>{row.projects}</td><td>{row.requests}</td><td>{row.aiChecks}</td><td>{row.documents}</td><td>{row.changeOrders}</td>
          <td>{ago(row.lastActiveAt)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
