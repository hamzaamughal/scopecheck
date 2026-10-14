"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Decision, Project, Request } from "@/lib/demo-data";
import { ApiClientError } from "@/lib/api-client";
import { toProjectView } from "@/lib/project-view";
import { toRequestView } from "@/lib/request-view";
import { createRequestSchema } from "@/schemas/request";
import { createRequest, deleteRequest, listRequests, updateRequestContent } from "@/services/requests";
import { createProjectSchema } from "@/schemas/project";
import { createProject, deleteProject, importLink, listProjects, updateProject } from "@/services/projects";
import type { FieldError } from "@/types/api";
import AccountMenu from "@/components/account-menu";
import { Icon, Modal } from "@/components/ui";
import ThemeToggle from "@/components/theme-toggle";
import DecisionForm from "@/components/decision-form";
import AssessmentPanel from "@/components/assessment-panel";
import ScopeField, { sourceSummary } from "@/components/scope-field";
import ReplyDraft from "@/components/reply-draft";
import ScopeHistory from "@/components/scope-history";
import DocumentsPanel from "@/components/documents-panel";
import { ChangeOrderForm, ChangeOrdersPanel, formatEstimate, type ChangeOrderPrefill } from "@/components/change-orders";
import { listChangeOrders } from "@/services/workflow";
import type { ChangeOrderDto } from "@/types/workflow";
import type { RequestDecision } from "@/types/request";
import { ScopeDiff, ScopeText } from "@/components/scope-view";
import type { ImportLinkData, ProjectDto } from "@/types/project";
import { useAssessmentUsage } from "@/hooks/use-assessment-usage";
import { useAssessments } from "@/hooks/use-assessments";

const DECISION_VALUES: Record<Decision, RequestDecision> = { Included: "included", "Extra work": "extra_work", "Needs clarification": "needs_clarification" };

function Badge({ decision }: { decision?: Decision }) {
  return <span className={`badge ${decision === "Included" ? "included" : decision === "Extra work" ? "extra" : decision ? "clarify" : "pending"}`}><span/>{decision || "To review"}</span>;
}

export default function Workspace({ user, googleEnabled }: { user: { id: string; name: string; email: string }; googleEnabled: boolean }) {
  const allowance = useAssessmentUsage();
  const { states: assessments, generate: generateAssessment, load: loadAssessment } = useAssessments(allowance.refresh);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const savingRef = useRef(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [tab, setTab] = useState("requests");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState<"project" | "editProject" | "deleteProject" | "request" | "editRequest" | "deleteRequest" | "scopeChanges" | "help" | null>(null);
  const [changeOrders, setChangeOrders] = useState<Record<string, ChangeOrderDto[]>>({});
  const [coErrors, setCoErrors] = useState<Record<string, string>>({});
  const [coReload, setCoReload] = useState(0);
  const [coForm, setCoForm] = useState<ChangeOrderPrefill | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scopeCheck, setScopeCheck] = useState<{ loading: boolean; result?: ImportLinkData; error?: string }>({ loading: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const project = projects.find(p => p.id === projectId);
  const request = project?.requests.find(r => r.id === requestId);
  const requests = projects.flatMap(p => p.requests);
  const pending = requests.filter(r => !r.decision).length;
  const visible = projects.filter(p => `${p.name} ${p.client}`.toLowerCase().includes(search.toLowerCase()) && (filter !== "pending" || p.requests.some(r => !r.decision)));

  useEffect(() => {
    if (projectId && requestId) void loadAssessment(projectId, requestId);
  }, [projectId, requestId, loadAssessment]);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    listChangeOrders(projectId, controller.signal)
      .then(({ changeOrders: orders }) => setChangeOrders(all => ({ ...all, [projectId]: orders })))
      .catch(error => { if (!controller.signal.aborted) setCoErrors(all => ({ ...all, [projectId]: error instanceof Error ? error.message : "Could not load change orders." })); });
    return () => controller.abort();
  }, [projectId, coReload]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 3500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    listProjects(controller.signal).then(async ({ projects }) => {
      // Load saved requests too, so card counts and review filters reflect the database.
      const workspace = await Promise.all(projects.map(async project => {
        const { requests } = await listRequests(project.id, controller.signal);
        return { ...toProjectView(project), requests: requests.map(toRequestView) };
      }));
      if (!controller.signal.aborted) setProjects(workspace);
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load projects.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reload]);
  function retryProjects() { setLoadError(""); setLoading(true); setReload(value => value + 1); }
  function fieldError(field: string) { return fieldErrors.find(error => error.field === field)?.message; }
  function openProject(id: string) { setProjectId(id); setRequestId(null); setTab("requests"); }
  function openRequest(item: Request) { setRequestId(item.id); }
  function openModal(value: typeof modal) { setError(""); setFieldErrors([]); setModal(value); }
  async function submitProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingRef.current) return;
    const data = new FormData(e.currentTarget);
    const rawSource = data.get("source");
    let source: unknown;
    try { source = typeof rawSource === "string" && rawSource ? JSON.parse(rawSource) : undefined; } catch { source = undefined; }
    const parsed = createProjectSchema.safeParse({ name: data.get("name"), clientName: data.get("client"), scope: data.get("scope"), source });
    setError(""); setFieldErrors([]);
    if (!parsed.success) {
      setFieldErrors(parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
      return;
    }
    savingRef.current = true; setSaving(true);
    const editing = modal === "editProject" ? project : undefined;
    try {
      if (editing) {
        const { project: saved } = await updateProject(editing.id, parsed.data);
        // Keep loaded requests; only project fields changed.
        setProjects(items => items.map(p => p.id === saved.id ? { ...toProjectView(saved), requests: p.requests } : p));
        setModal(null);
        if (requestId) void loadAssessment(saved.id, requestId); // Refresh the stale flag.
        setNotice("Project updated.");
        return;
      }
      const { project } = await createProject(parsed.data);
      setProjects(items => [toProjectView(project), ...items]);
      setSearch(""); setFilter("all"); setModal(null); openProject(project.id);
      setNotice("Project saved successfully.");
    } catch (error) {
      if (error instanceof ApiClientError) setFieldErrors(error.details);
      const message = error instanceof Error ? error.message : "Could not save the project.";
      setError(error instanceof ApiClientError && error.code === "NETWORK_ERROR"
        ? "Connection lost while saving. Your project may have been saved. Close this form and refresh to check before trying again."
        : message);
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }
  async function submitRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingRef.current || !projectId) return;
    const targetProjectId = projectId;
    const data = new FormData(e.currentTarget);
    const parsed = createRequestSchema.safeParse({ title: data.get("title"), description: data.get("description") });
    setError(""); setFieldErrors([]);
    if (!parsed.success) {
      setFieldErrors(parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
      return;
    }
    savingRef.current = true; setSaving(true);
    const editing = modal === "editRequest" ? request : undefined;
    try {
      if (editing) {
        const { request: saved } = await updateRequestContent(targetProjectId, editing.id, parsed.data);
        const updated = toRequestView(saved);
        setProjects(items => items.map(p => p.id === targetProjectId ? { ...p, requests: p.requests.map(r => r.id === saved.id ? updated : r) } : p));
        setModal(null);
        void loadAssessment(targetProjectId, saved.id); // Refresh the stale flag.
        setNotice("Request updated.");
        return;
      }
      const { request } = await createRequest(targetProjectId, parsed.data);
      const item = toRequestView(request);
      setProjects(items => items.map(p => p.id === targetProjectId ? { ...p, requests: [item, ...p.requests] } : p));
      setModal(null); openRequest(item); setTab("requests");
      setNotice("Request saved successfully.");
    } catch (error) {
      if (error instanceof ApiClientError) setFieldErrors(error.details);
      const message = error instanceof Error ? error.message : "Could not save the request.";
      setError(error instanceof ApiClientError && error.code === "NETWORK_ERROR"
        ? "Connection lost while saving. Your request may have been saved. Close this form and refresh to check before trying again."
        : message);
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }
  async function confirmDelete() {
    if (savingRef.current || !project) return;
    const target = { projectId: project.id, requestId: modal === "deleteRequest" ? request?.id : undefined };
    if (modal === "deleteRequest" && !target.requestId) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      try {
        if (target.requestId) await deleteRequest(target.projectId, target.requestId);
        else await deleteProject(target.projectId);
      } catch (error) {
        // Already gone (e.g. deleted in another tab): remove it here too.
        if (!(error instanceof ApiClientError && error.code === "NOT_FOUND")) throw error;
      }
      if (target.requestId) {
        setProjects(items => items.map(p => p.id === target.projectId ? { ...p, requests: p.requests.filter(r => r.id !== target.requestId) } : p));
        setRequestId(null);
        setNotice("Request deleted.");
      } else {
        setProjects(items => items.filter(p => p.id !== target.projectId));
        setProjectId(null); setRequestId(null);
        setNotice("Project deleted.");
      }
      setModal(null);
    } catch (error) {
      setError(error instanceof ApiClientError && error.code === "NETWORK_ERROR"
        ? "Connection lost. Refresh to check whether it was deleted before trying again."
        : error instanceof Error ? error.message : "Could not delete. Please try again.");
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }
  async function checkScopeLink() {
    if (!project?.source?.sourceUrl) return;
    setScopeCheck({ loading: true }); setModal("scopeChanges");
    try {
      const result = await importLink(project.source.sourceUrl, project.id);
      setScopeCheck({ loading: false, result });
    } catch (error) {
      setScopeCheck({ loading: false, error: error instanceof ApiClientError ? error.details[0]?.message ?? error.message : "Could not check the link." });
    }
  }
  async function applyScopeUpdate() {
    const result = scopeCheck.result;
    if (!project || !result || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const { project: saved } = await updateProject(project.id, { name: project.name, clientName: project.clientName ?? "", scope: result.text, source: { kind: "link", label: result.label, sourceUrl: project.source?.sourceUrl ?? result.sourceUrl } });
      setProjects(items => items.map(p => p.id === saved.id ? { ...toProjectView(saved), requests: p.requests } : p));
      if (requestId) void loadAssessment(saved.id, requestId);
      setModal(null); setNotice("Scope updated from the link.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the scope.");
    } finally { savingRef.current = false; setSaving(false); }
  }
  const projectOrders = (project && changeOrders[project.id]) || [];
  const requestDecision: RequestDecision | null = request?.decision ? DECISION_VALUES[request.decision] : null;
  const requestOrder = request ? projectOrders.find(order => order.requestId === request.id && order.status !== "rejected") : undefined;
  function applyProjectUpdate(saved: ProjectDto) {
    setProjects(items => items.map(p => p.id === saved.id ? { ...toProjectView(saved), requests: p.requests } : p));
    if (requestId) void loadAssessment(saved.id, requestId);
  }
  const editingProject = modal === "editProject" ? project : undefined;
  const editingRequest = modal === "editRequest" ? request : undefined;

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setProjectId(null)}><span className="brand-mark"><Icon name="check" size={20}/></span>scopecheck<span className="brand-dot">.</span></button><span className="top-divider"/><span className="workspace-name">Personal workspace</span><div className="topbar-right">{process.env.NODE_ENV !== "production" && <span className="demo-label"><span/> Development</span>}<ThemeToggle/><button className="icon-button" aria-label="How ScopeCheck works" onClick={() => openModal("help")}><Icon name="help"/></button><AccountMenu user={user} googleEnabled={googleEnabled}/></div></header>
    <div className="workspace-bar"><nav className="workspace-nav" aria-label="Workspace"><button className="nav-active" onClick={() => { setProjectId(null); setRequestId(null); }}><Icon name="grid"/>Projects<span className="count">{loading || loadError ? "—" : projects.length}</span></button></nav><span className="session-note">Projects, requests & decisions saved</span></div>
    <main className="main-content">
      {loading ? <section className="data-state" role="status"><span className="loading-ring"/><h1>Loading your projects</h1><p>Getting your saved workspace ready.</p></section> : loadError ? <section className="data-state" role="alert"><span className="empty-icon"><Icon name="folder" size={30}/></span><h1>Couldn’t load your projects</h1><p>{loadError}</p><button className="button primary" onClick={retryProjects}>Try again</button></section> : !project ? <>
        <section className="page-heading"><div><div className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</div><h1>Good projects start with clear scope.</h1><p>Keep client requests aligned, and make room for the work that matters.</p></div><button className="button primary" onClick={() => openModal("project")}><Icon name="plus"/>New project</button></section>
        <section className="overview-strip" aria-label="Workspace summary"><div><span className="stat-icon lavender"><Icon name="folder"/></span><div><span className="stat-number">{projects.length}</span><span className="stat-label">Active projects</span></div></div><div><span className="stat-icon amber"><Icon name="clock"/></span><div><span className="stat-number">{pending}<span className="stat-hint">{pending ? "Ready for your review" : "All caught up"}</span></span><span className="stat-label">Requests to review</span></div></div><div><span className="stat-icon mint"><Icon name="check"/></span><div><span className="stat-number">{requests.filter(r => r.decision).length}</span><span className="stat-label">Decisions recorded</span></div></div></section>
        <section className="projects-section"><div className="section-heading"><div><h2>Your projects <span>{projects.length}</span></h2><p>A clear view of what’s agreed and what’s next.</p></div><label className="search-box"><Icon name="search"/><input aria-label="Search projects" placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)}/></label></div><div className="filter-row"><div className="segmented"><button className={filter === "all" ? "selected" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All projects</button><button className={filter === "pending" ? "selected" : ""} aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>Needs review <span>{projects.filter(p => p.requests.some(r => !r.decision)).length}</span></button></div><span className="small-muted">{visible.length} {visible.length === 1 ? "project" : "projects"}</span></div>
          <div className="project-grid">{visible.map(p => <button className="project-card" key={p.id} onClick={() => openProject(p.id)}><div className="card-top"><span className={`project-avatar ${p.color}`}>{p.initials}</span><span className="active-label"><span/>Active</span></div><div className="client-label">{p.client}</div><h3>{p.name}</h3><p className="scope-excerpt">{p.description}</p><div className="card-scope"><Icon name="file" size={15}/>Agreed scope added<Icon name="check" size={14}/></div><div className="card-bottom"><span><Icon name="file" size={15}/>{p.requests.length} {p.requests.length === 1 ? "request" : "requests"}</span>{p.requests.some(r => !r.decision) ? <span className="review-label">{p.requests.filter(r => !r.decision).length} to review<span className="tiny-dot"/></span> : <span className="small-muted">All clear<Icon name="arrow" size={14}/></span>}</div></button>)}<button className="new-project-card" onClick={() => openModal("project")}><span className="add-circle"><Icon name="plus" size={23}/></span><h3>A fresh start, clearly defined.</h3><p>Add your project and agreed scope.<br/>We’ll take it one request at a time.</p><span>Create a project <Icon name="arrow" size={14}/></span></button></div>
          {visible.length === 0 && <p className="empty-search">{projects.length === 0 ? "No projects yet. Create your first project to save its agreed scope." : "No projects match this view. Try another search or filter."}</p>}
        </section>
        <section className="guide-banner"><span className="guide-icon"><Icon name="sparkle" size={24}/></span><div><h3>A second pair of eyes. You make the call.</h3><p>Compare requests with the agreed scope, review the evidence, and record your decision.</p></div><button className="text-button" onClick={() => openModal("help")}>How it works<Icon name="arrow" size={15}/></button></section>
      </> : <>
        <button className="back-link" onClick={() => { setProjectId(null); setRequestId(null); }}><Icon name="back" size={16}/>All projects</button>
        <section className="page-heading detail-heading"><div className="project-title"><span className={`project-avatar large ${project.color}`}>{project.initials}</span><div><div className="client-label">{project.client}</div><h1>{project.name}</h1><p>Your saved project scope and client requests.</p></div></div><div className="heading-actions"><a className="button secondary" href={`/projects/${project.id}/report`} target="_blank" rel="noopener"><Icon name="receipt" size={16}/>Report</a><button className="button secondary" onClick={() => openModal("editProject")}><Icon name="edit" size={16}/>Edit</button><button className="button secondary" onClick={() => openModal("deleteProject")}><Icon name="trash" size={16}/>Delete</button><button className="button primary" onClick={() => openModal("request")}><Icon name="plus"/>New request</button></div></section>
        <p className="request-preview-note">Requests and decisions are saved to this project.</p><div className="detail-tabs"><button className={tab === "requests" ? "selected" : ""} aria-pressed={tab === "requests"} onClick={() => setTab("requests")}><Icon name="file" size={16}/>Client requests <span className="count">{project.requests.length}</span></button><button className={tab === "scope" ? "selected" : ""} aria-pressed={tab === "scope"} onClick={() => setTab("scope")}><Icon name="folder" size={16}/>Agreed scope</button><button className={tab === "changes" ? "selected" : ""} aria-pressed={tab === "changes"} onClick={() => setTab("changes")}><Icon name="receipt" size={16}/>Change orders <span className="count">{projectOrders.length}</span></button></div>
        {tab === "changes" ? <ChangeOrdersPanel projectId={project.id} orders={projectOrders} loading={!changeOrders[project.id] && !coErrors[project.id]} loadError={changeOrders[project.id] ? "" : coErrors[project.id] ?? ""}
          requestTitles={Object.fromEntries(project.requests.map(r => [r.id, r.title]))} onRetry={() => { setCoErrors(all => ({ ...all, [project.id]: "" })); setCoReload(value => value + 1); }} onNew={() => setCoForm({ title: "", description: "" })}
          onChanged={orders => setChangeOrders(all => ({ ...all, [project.id]: orders }))} onProjectUpdated={applyProjectUpdate} onNotice={setNotice}/>
        : tab === "scope" ? <><section className="scope-document"><div className="document-header"><span className="stat-icon lavender"><Icon name="file"/></span><div><h2>The agreed scope</h2><p>Your reference point for every client request.</p></div><button type="button" className="button secondary small" onClick={() => setHistoryOpen(true)}><Icon name="history" size={14}/>History</button></div>{project.source && <div className="scope-source-bar"><span><Icon name={project.source.kind === "link" ? "link" : "file"} size={14}/>Imported from {project.source.kind === "link" && project.source.sourceUrl ? <a href={project.source.sourceUrl} target="_blank" rel="noopener noreferrer">{sourceSummary(project.source)}</a> : sourceSummary(project.source)} · {new Date(project.source.importedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}{project.source.editedSinceImport && " · edited since import"}</span>{project.source.kind === "link" && <button className="button secondary small" onClick={() => void checkScopeLink()}><Icon name="refresh" size={14}/>Check for changes</button>}</div>}<ScopeText scope={project.scope}/></section><DocumentsPanel key={project.id} projectId={project.id}/></> : <div className={`review-layout ${request ? "has-selection" : ""}`}><section className="request-list"><div className="list-heading"><h2>Client requests</h2><span className="small-muted">{project.requests.filter(r => !r.decision).length} to review</span></div>{project.requests.length ? project.requests.map(r => <button key={r.id} className={`request-row ${requestId === r.id ? "selected" : ""}`} onClick={() => openRequest(r)}><div className="request-row-top"><Badge decision={r.decision}/><span>{r.date}</span></div><h3>{r.title}</h3><p>{r.description}</p><span className="request-open">Review request<Icon name="arrow" size={14}/></span></button>) : <div className="empty-state"><span className="empty-icon"><Icon name="file" size={28}/></span><h3>Room for the next conversation.</h3><p>Add a client request to review it against your agreed scope.</p><button className="button secondary" onClick={() => openModal("request")}><Icon name="plus" size={16}/>Add first request</button></div>}</section>
          <section className="review-panel" aria-label="Request review">{request ? <><div className="review-panel-heading"><span className="eyebrow">REQUEST REVIEW</span><div className="review-panel-actions"><button className="icon-button" aria-label="Edit request" title="Edit request" onClick={() => openModal("editRequest")}><Icon name="edit" size={17}/></button><button className="icon-button" aria-label="Delete request" title="Delete request" onClick={() => openModal("deleteRequest")}><Icon name="trash" size={17}/></button><button className="icon-button" aria-label="Close request review" onClick={() => setRequestId(null)}><Icon name="close" size={17}/></button></div></div><h2>{request.title}</h2><p className="request-description">{request.description}</p><AssessmentPanel scope={project.scope} allowance={allowance} state={assessments[`${project.id}/${request.id}`]} onGenerate={() => void generateAssessment(project.id, request.id)} onLoad={() => void loadAssessment(project.id, request.id)}/><details className="scope-details"><summary>Read the full agreed scope<Icon name="file" size={16}/></summary><div>{project.scope}</div></details><DecisionForm key={request.id} projectId={project.id} request={request} onSaved={saved => {
            const updated = toRequestView(saved);
            setProjects(items => items.map(p => p.id === saved.projectId ? { ...p, requests: p.requests.map(r => r.id === saved.id ? updated : r) } : p));
            setNotice("Decision saved successfully.");
          }}/>{requestDecision === "extra_work" && <div className="co-prompt">{requestOrder ? <span><Icon name="receipt" size={15}/>Change order #{requestOrder.number} · {requestOrder.status}{formatEstimate(requestOrder) ? ` · ${formatEstimate(requestOrder)}` : ""}</span> : <span>This is extra work. Turn it into a change order with an estimate.</span>}
            {requestOrder ? <button type="button" className="text-button" onClick={() => setTab("changes")}>View<Icon name="arrow" size={14}/></button> : <button type="button" className="button secondary small" onClick={() => setCoForm({ title: request.title, description: request.description, requestId: request.id })}><Icon name="plus" size={14}/>Create change order</button>}</div>}
          <ReplyDraft key={`reply-${request.id}`} projectId={project.id} requestId={request.id} decision={requestDecision} allowance={allowance}/></> : <div className="empty-state review-empty"><div className="scope-illustration"><Icon name="file" size={40}/><span><Icon name="check" size={18}/></span></div><h3>A little context. A clearer decision.</h3><p>Select a request to see the details, compare it with your scope, and decide what comes next.</p><span className="small-muted">Your scope is the source of truth.</span></div>}</section></div>}
      </>}
      <footer><span className="footer-brand"><Icon name="check" size={14}/>ScopeCheck</span><span>Clear scope. Better conversations.</span><span>Made for thoughtful project work.</span></footer>
    </main>
    {notice && <div className="toast" role="status"><Icon name="check" size={18}/>{notice}</div>}
    {(modal === "project" || editingProject) && <Modal title={editingProject ? "Edit project" : "Start with a clear scope."} subtitle={editingProject ? "Changing the scope marks saved AI suggestions as outdated. Your decisions are kept." : "Add the agreement that your client requests will be reviewed against."} busy={saving} onClose={() => setModal(null)}><form onSubmit={submitProject} aria-busy={saving}><fieldset disabled={saving} className="project-fields"><label htmlFor="project-name">Project name <span>*</span></label><input id="project-name" name="name" aria-invalid={!!fieldError("name")} aria-describedby={fieldError("name") ? "name-error" : undefined} placeholder="e.g. Acme website redesign" required maxLength={100} defaultValue={editingProject?.name}/>{fieldError("name") && <p className="form-error" id="name-error" role="alert">{fieldError("name")}</p>}<label htmlFor="client-name">Client name <span>(optional)</span></label><input id="client-name" name="client" aria-invalid={!!fieldError("clientName")} aria-describedby={fieldError("clientName") ? "client-error" : undefined} placeholder="e.g. Acme Studio" maxLength={100} defaultValue={editingProject?.clientName ?? ""}/>{fieldError("clientName") && <p className="form-error" id="client-error" role="alert">{fieldError("clientName")}</p>}<ScopeField key={editingProject?.id ?? "new"} defaultValue={editingProject?.scope} existingSource={editingProject?.source} error={fieldError("scope") ?? fieldError("source")}/>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" type="submit">{saving ? "Saving project…" : editingProject ? "Save changes" : "Create project"}<Icon name="arrow" size={16}/></button></div></fieldset></form></Modal>}
    {(modal === "request" || editingRequest) && <Modal title={editingRequest ? "Edit request" : "What’s the client asking for?"} subtitle={editingRequest ? "Changing the wording marks saved AI suggestions as outdated. Your decision is kept." : "Keep the original wording so you don’t lose important context."} busy={saving} onClose={() => setModal(null)}><form onSubmit={submitRequest} aria-busy={saving}><fieldset disabled={saving} className="project-fields"><label htmlFor="request-title">Request title <span>*</span></label><input id="request-title" name="title" aria-invalid={!!fieldError("title")} aria-describedby={fieldError("title") ? "request-title-error" : undefined} placeholder="e.g. Add a client login area" required maxLength={120} defaultValue={editingRequest?.title}/>{fieldError("title") && <p className="form-error" id="request-title-error" role="alert">{fieldError("title")}</p>}<label htmlFor="request-description">Client request <span>*</span></label><textarea id="request-description" name="description" aria-invalid={!!fieldError("description")} aria-describedby={fieldError("description") ? "request-description-error" : undefined} rows={6} placeholder="Paste or describe the client's request..." required maxLength={10000} defaultValue={editingRequest?.description}/>{fieldError("description") && <p className="form-error" id="request-description-error" role="alert">{fieldError("description")}</p>}<p className="field-hint">Save your request, then assess it against the agreed scope.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancel</button><button className="button primary" type="submit">{saving ? "Saving request…" : editingRequest ? "Save changes" : "Add request"}<Icon name="arrow" size={16}/></button></div></fieldset></form></Modal>}
    {(modal === "deleteProject" || modal === "deleteRequest") && project && <Modal title={modal === "deleteProject" ? "Delete this project?" : "Delete this request?"} subtitle={modal === "deleteProject" ? `“${project.name}”, its ${project.requests.length} ${project.requests.length === 1 ? "request" : "requests"}, decisions, and saved AI suggestions will be permanently deleted.` : `“${request?.title ?? ""}”, its decision, and its saved AI suggestions will be permanently deleted.`} busy={saving} onClose={() => setModal(null)}><p className="field-hint">This cannot be undone.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setModal(null)}>Cancel</button><button type="button" className="button danger" disabled={saving} onClick={() => void confirmDelete()}><Icon name="trash" size={16}/>{saving ? "Deleting…" : "Delete permanently"}</button></div></Modal>}
    {modal === "scopeChanges" && project && <Modal title="Check the linked scope" subtitle={project.source?.sourceUrl ? `Compares your saved scope with ${project.source.sourceUrl.replace(/^https?:\/\//, "")} as it is now.` : ""} busy={saving} onClose={() => setModal(null)}>
      {scopeCheck.loading ? <p className="scope-check-status" role="status"><span className="spinner"/>Fetching the latest version…</p>
        : scopeCheck.error ? <p className="form-error" role="alert">{scopeCheck.error}</p>
        : scopeCheck.result && (scopeCheck.result.text === project.scope ? <p className="scope-check-status" role="status"><Icon name="check" size={16}/>No changes. Your saved scope matches the link.</p>
        : <ScopeDiff before={project.scope} after={scopeCheck.result.text}/>)}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setModal(null)}>Close</button>{scopeCheck.result && scopeCheck.result.text !== project.scope && <button type="button" className="button primary" disabled={saving} onClick={() => void applyScopeUpdate()}>{saving ? "Updating…" : "Use the new version"}</button>}</div>
    </Modal>}
    {coForm && project && <ChangeOrderForm projectId={project.id} prefill={coForm} onClose={() => setCoForm(null)} onSaved={order => { setChangeOrders(all => ({ ...all, [project.id]: [order, ...(all[project.id] ?? [])] })); setCoForm(null); setNotice(`Change order #${order.number} created.`); }}/>}
    {historyOpen && project && <ScopeHistory projectId={project.id} currentScope={project.scope} onClose={() => setHistoryOpen(false)}/>}
    {modal === "help" && <Modal title="Less guesswork. More clarity." subtitle="A simple workflow for the requests that arrive after the agreement." onClose={() => setModal(null)}><div className="help-steps">{[["01", "Set the baseline", "Create a project and paste the scope you agreed with your client."], ["02", "Capture the request", "Add the client's words and compare them with the original agreement."], ["03", "Make the call", "Record whether it is included, extra work, or needs clarification."]].map(([number, title, copy]) => <div key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></div>)}</div><div className="preview-notice"><strong>Your projects and requests are saved.</strong><p>Projects, agreed scopes, and client requests are stored in the database. Your decisions and notes are saved too. AI suggestions help you review the scope; you make the final decision. Assessments are saved with the scope and request they were based on.</p></div><button className="button primary full-width" onClick={() => setModal(null)}>Got it<Icon name="check" size={16}/></button></Modal>}
  </div>;
}



