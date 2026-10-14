"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon, Modal } from "@/components/ui";
import { ApiClientError } from "@/lib/api-client";
import { CURRENCIES, changeOrderInputSchema } from "@/schemas/workflow";
import { acceptChangeOrder, createChangeOrder, deleteChangeOrder, editChangeOrder, rejectChangeOrder } from "@/services/workflow";
import type { ProjectDto } from "@/types/project";
import type { ChangeOrderDto } from "@/types/workflow";
import type { FieldError } from "@/types/api";

export type ChangeOrderPrefill = { title: string; description: string; requestId?: string };

export function formatEstimate(order: Pick<ChangeOrderDto, "hours" | "amountCents" | "currency">) {
  const money = order.amountCents !== null
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: order.currency, maximumFractionDigits: 2 }).format(order.amountCents / 100) : "";
  return [order.hours !== null ? `${order.hours} h` : "", money].filter(Boolean).join(" · ");
}

const STATUS_LABEL = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" } as const;

// Create or edit form (edit only while proposed).
export function ChangeOrderForm({ projectId, prefill, editing, onClose, onSaved }: {
  projectId: string; prefill?: ChangeOrderPrefill; editing?: ChangeOrderDto; onClose: () => void; onSaved: (order: ChangeOrderDto) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const fieldError = (field: string) => errors.find(item => item.field === field)?.message;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const data = new FormData(event.currentTarget);
    const raw = { title: data.get("title"), description: data.get("description"), hours: data.get("hours"), amount: data.get("amount"), currency: data.get("currency"), requestId: editing ? undefined : prefill?.requestId };
    const parsed = changeOrderInputSchema.safeParse(raw);
    setError(""); setErrors([]);
    if (!parsed.success) { setErrors(parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message }))); return; }
    lock.current = true; setSaving(true);
    try {
      const { requestId, ...fields } = parsed.data;
      const { changeOrder } = editing ? await editChangeOrder(projectId, editing.id, fields) : await createChangeOrder(projectId, { ...fields, requestId });
      onSaved(changeOrder);
    } catch (caught) {
      if (caught instanceof ApiClientError) setErrors(caught.details);
      setError(caught instanceof Error ? caught.message : "Could not save the change order.");
    } finally { lock.current = false; setSaving(false); }
  }

  const initial = editing ?? prefill;
  return <Modal title={editing ? `Edit change order #${editing.number}` : "New change order"} subtitle="Describe the extra work and, if you know it, the estimate. Accepting it later adds it to the agreed scope." busy={saving} onClose={onClose}>
    <form onSubmit={submit} aria-busy={saving}><fieldset disabled={saving} className="project-fields">
      <label htmlFor="co-title">Title <span>*</span></label>
      <input id="co-title" name="title" required maxLength={160} defaultValue={initial?.title} placeholder="e.g. Client login area" aria-invalid={!!fieldError("title")}/>
      {fieldError("title") && <p className="form-error" role="alert">{fieldError("title")}</p>}
      <label htmlFor="co-description">What it includes <span>*</span></label>
      <textarea id="co-description" name="description" required maxLength={5000} rows={5} defaultValue={initial?.description} placeholder="Deliverables, assumptions, and anything not included" aria-invalid={!!fieldError("description")}/>
      {fieldError("description") && <p className="form-error" role="alert">{fieldError("description")}</p>}
      <div className="co-estimate">
        <div><label htmlFor="co-hours">Hours <span>(optional)</span></label><input id="co-hours" name="hours" type="number" inputMode="decimal" min="0" step="0.25" defaultValue={editing?.hours ?? ""} aria-invalid={!!fieldError("hours")}/></div>
        <div><label htmlFor="co-amount">Price <span>(optional)</span></label><input id="co-amount" name="amount" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={editing?.amountCents != null ? editing.amountCents / 100 : ""} aria-invalid={!!fieldError("amount")}/></div>
        <div><label htmlFor="co-currency">Currency</label><select id="co-currency" name="currency" defaultValue={editing?.currency ?? "USD"}>{CURRENCIES.map(code => <option key={code} value={code}>{code}</option>)}</select></div>
      </div>
      {(fieldError("hours") || fieldError("amount")) && <p className="form-error" role="alert">{fieldError("hours") ?? fieldError("amount")}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">{saving ? "Saving…" : editing ? "Save changes" : "Create change order"}</button></div>
    </fieldset></form>
  </Modal>;
}

// Tab content: list with accept / reject / edit / delete.
export function ChangeOrdersPanel({ projectId, orders, loading, loadError, requestTitles, onRetry, onNew, onChanged, onProjectUpdated, onNotice }: {
  projectId: string; orders: ChangeOrderDto[]; loading: boolean; loadError: string; requestTitles: Record<string, string>;
  onRetry: () => void; onNew: () => void; onChanged: (orders: ChangeOrderDto[]) => void; onProjectUpdated: (project: ProjectDto) => void; onNotice: (text: string) => void;
}) {
  const [confirm, setConfirm] = useState<{ kind: "accept" | "reject" | "delete"; order: ChangeOrderDto } | null>(null);
  const [editing, setEditing] = useState<ChangeOrderDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!confirm || busy) return;
    setBusy(true); setError("");
    const { kind, order } = confirm;
    try {
      if (kind === "delete") {
        await deleteChangeOrder(projectId, order.id);
        onChanged(orders.filter(item => item.id !== order.id)); onNotice(`Change order #${order.number} deleted.`);
      } else if (kind === "accept") {
        const { changeOrder, project } = await acceptChangeOrder(projectId, order.id);
        onChanged(orders.map(item => item.id === changeOrder.id ? changeOrder : item)); onProjectUpdated(project);
        onNotice(`Change order #${order.number} accepted and added to the scope.`);
      } else {
        const { changeOrder } = await rejectChangeOrder(projectId, order.id);
        onChanged(orders.map(item => item.id === changeOrder.id ? changeOrder : item)); onNotice(`Change order #${order.number} marked as rejected.`);
      }
      setConfirm(null);
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.code === "NETWORK_ERROR" ? "Connection lost. Refresh to check whether it was saved." : caught instanceof Error ? caught.message : "Could not update the change order.");
    } finally { setBusy(false); }
  }

  const accepted = orders.filter(order => order.status === "accepted");
  const totals = Object.entries(accepted.reduce<Record<string, number>>((sum, order) => { if (order.amountCents !== null) sum[order.currency] = (sum[order.currency] ?? 0) + order.amountCents; return sum; }, {}));
  return <section className="change-orders">
    <div className="co-header">
      <div><h2>Change orders</h2><p>Extra work you propose to the client. Accepted orders are added to the agreed scope as a new version.</p></div>
      <button type="button" className="button primary" onClick={onNew}><Icon name="plus" size={16}/>New change order</button>
    </div>
    {totals.length > 0 && <p className="co-total">Accepted so far: <strong>{totals.map(([currency, cents]) => formatEstimate({ hours: null, amountCents: cents, currency })).join(" + ")}</strong></p>}
    {loading ? <p className="reply-empty" role="status">Loading change orders…</p>
      : loadError ? <div className="reply-empty" role="alert">{loadError} <button type="button" className="text-button inline" onClick={onRetry}>Try again</button></div>
      : orders.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="receipt" size={28}/></span><h3>No change orders yet.</h3><p>When a request is extra work, turn it into a change order with an estimate.</p></div>
      : <ul className="co-list">{orders.map(order => <li key={order.id} className={`co-card ${order.status}`}>
        <div className="co-card-top"><span className="co-number">#{order.number}</span><span className={`co-status ${order.status}`}>{STATUS_LABEL[order.status]}</span></div>
        <h3>{order.title}</h3>
        <p className="co-description">{order.description}</p>
        <div className="co-meta">
          <span>{formatEstimate(order) || "No estimate"}</span>
          {order.requestId && requestTitles[order.requestId] && <span>From request: {requestTitles[order.requestId]}</span>}
          <span>{order.decidedAt ? `${STATUS_LABEL[order.status]} ${new Date(order.decidedAt).toLocaleDateString()}` : `Created ${new Date(order.createdAt).toLocaleDateString()}`}</span>
        </div>
        <div className="co-actions">
          {order.status === "proposed" && <><button type="button" className="button primary small" onClick={() => setConfirm({ kind: "accept", order })}><Icon name="check" size={14}/>Accept</button>
            <button type="button" className="button secondary small" onClick={() => setConfirm({ kind: "reject", order })}>Reject</button>
            <button type="button" className="button secondary small" onClick={() => setEditing(order)}><Icon name="edit" size={14}/>Edit</button></>}
          {order.status !== "accepted" && <button type="button" className="icon-button" aria-label={`Delete change order #${order.number}`} onClick={() => setConfirm({ kind: "delete", order })}><Icon name="trash" size={16}/></button>}
        </div>
      </li>)}</ul>}

    {confirm && <Modal title={confirm.kind === "accept" ? `Accept change order #${confirm.order.number}?` : confirm.kind === "reject" ? `Reject change order #${confirm.order.number}?` : `Delete change order #${confirm.order.number}?`}
      subtitle={confirm.kind === "accept" ? "It will be added to the end of the agreed scope as a new version. Earlier AI suggestions will show as outdated." : confirm.kind === "reject" ? "It stays in the log as rejected. The scope does not change." : "This removes it permanently."}
      busy={busy} onClose={() => setConfirm(null)}>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
        <button type="button" className={`button ${confirm.kind === "delete" ? "danger" : "primary"}`} disabled={busy} onClick={() => void run()}>{busy ? "Saving…" : confirm.kind === "accept" ? "Accept and add to scope" : confirm.kind === "reject" ? "Mark as rejected" : "Delete"}</button></div>
    </Modal>}
    {editing && <ChangeOrderForm projectId={projectId} editing={editing} onClose={() => setEditing(null)} onSaved={saved => { onChanged(orders.map(item => item.id === saved.id ? saved : item)); setEditing(null); onNotice("Change order updated."); }}/>}
  </section>;
}
