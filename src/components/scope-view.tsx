import type { ReactNode } from "react";
import { diffLines } from "@/lib/scope-import/normalize";

export function ScopeText({ scope }: { scope: string }) {
  // "[Page N]" lines from imported PDFs are shown as quiet dividers.
  const parts = scope.split(/^(\[Page \d+\])$/m);
  return <div className="scope-copy">{parts.map((part, index) => /^\[Page \d+\]$/.test(part)
    ? <span key={index} className="page-marker">{part.slice(1, -1)}</span>
    : parts.length > 1 ? part.replace(/^\n+|\n+$/g, "") : part)}</div>;
}

export function ScopeDiff({ before, after, note = "Assessments made before an update will be marked as outdated." }: { before: string; after: string; note?: string }) {
  const lines = diffLines(before, after);
  const added = lines.filter(line => line.type === "added").length, removed = lines.filter(line => line.type === "removed").length;
  // Show changed lines with one line of context; collapse long unchanged stretches.
  const keep = lines.map((line, i) => line.type !== "same" || lines[i - 1]?.type !== undefined && lines[i - 1].type !== "same" || lines[i + 1]?.type !== undefined && lines[i + 1].type !== "same");
  const rows: ReactNode[] = []; let skipped = 0;
  lines.forEach((line, i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { rows.push(<li key={`s${i}`} className="diff-skip">{skipped} unchanged {skipped === 1 ? "line" : "lines"}</li>); skipped = 0; }
    rows.push(<li key={i} className={`diff-${line.type}`}><span aria-hidden="true">{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span>{line.text || " "}</li>);
  });
  if (skipped) rows.push(<li key="end" className="diff-skip">{skipped} unchanged {skipped === 1 ? "line" : "lines"}</li>);
  return <div className="scope-diff"><p><strong>{added}</strong> {added === 1 ? "line" : "lines"} added, <strong>{removed}</strong> removed.{note ? ` ${note}` : ""}</p><ol>{rows}</ol></div>;
}
