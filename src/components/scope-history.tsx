"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { ScopeDiff, ScopeText } from "@/components/scope-view";
import { getScopeVersion, listScopeVersions } from "@/services/workflow";
import type { ScopeVersionDto } from "@/types/workflow";

const REASON = { initial: "Created", edit: "Edited", import: "Imported from a file or link", link_update: "Updated from link", change_order: "Change order accepted" } as const;

// Read-only scope history: pick a version to see what changed between it and the current scope.
export default function ScopeHistory({ projectId, currentScope, onClose }: { projectId: string; currentScope: string; onClose: () => void }) {
  const [versions, setVersions] = useState<ScopeVersionDto[] | null>(null);
  const [selected, setSelected] = useState<{ version: number; scope: string } | null>(null);
  const [view, setView] = useState<"diff" | "full">("diff");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    listScopeVersions(projectId, controller.signal).then(data => setVersions(data.versions))
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load the history."); });
    return () => controller.abort();
  }, [projectId]);

  async function open(version: number) {
    setError("");
    try { const { version: found } = await getScopeVersion(projectId, version); setSelected({ version: found.version, scope: found.scope }); setView("diff"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load that version."); }
  }

  const latest = versions?.[0]?.version;
  return <Modal title="Scope history" subtitle="Every saved version of the agreed scope. Select one to compare it with the current scope." onClose={onClose}>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!versions && !error ? <p className="scope-check-status" role="status"><span className="spinner"/>Loading…</p> : versions && <ol className="history-list">
      {versions.map(version => <li key={version.id}><button type="button" className={selected?.version === version.version ? "selected" : ""} onClick={() => void open(version.version)} aria-pressed={selected?.version === version.version}>
        <strong>v{version.version}</strong><span>{REASON[version.reason]}{version.changeOrderNumber ? ` #${version.changeOrderNumber}` : ""}</span>
        <span className="small-muted">{new Date(version.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}{version.version === latest ? " · current" : ""}</span>
      </button></li>)}
    </ol>}
    {selected && <div className="history-view">
      <div className="segmented" role="group" aria-label="View"><button type="button" className={view === "diff" ? "selected" : ""} aria-pressed={view === "diff"} onClick={() => setView("diff")}>Changes since v{selected.version}</button><button type="button" className={view === "full" ? "selected" : ""} aria-pressed={view === "full"} onClick={() => setView("full")}>Full text of v{selected.version}</button></div>
      {view === "diff" ? (selected.scope === currentScope ? <p className="scope-check-status">This version matches the current scope.</p> : <ScopeDiff before={selected.scope} after={currentScope} note=""/>) : <div className="history-full"><ScopeText scope={selected.scope}/></div>}
    </div>}
    <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
  </Modal>;
}
