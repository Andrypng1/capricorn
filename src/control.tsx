import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "./desktop";
import { ActionMenu, Chip, formatDate, Skeleton, Toasts } from "./ui";
import { es } from "./strings";

const labels = es.control;
const ui = es.detailUi;
type SuggestedStatus = keyof typeof ui.suggestions;

type Delivery = { id: string; version: number; link_id: string | null; delivered_at: string; notes: string | null; updated_at: string | null };
type Revision = { id: string; delivery_id: string | null; delivery_version: number | null; delivery_withdrawn: 0 | 1;
  text: string; done: 0 | 1; created_at: string; done_at: string | null; updated_at: string | null; };
type Details = { nextVersion: number; deliveries: Delivery[]; revisions: Revision[] };
type DeliveryLink = { id: string; title: string; url: string; service?:keyof typeof es.service };
type Editor =
  | { type: "delivery"; record?: Delivery; linkId?: string }
  | { type: "revision"; record?: Revision; deliveryId?: string }
  | { type: "remove-delivery"; record: Delivery }
  | { type: "remove-revision"; record: Revision };
type WriteCommand = "create_delivery" | "edit_delivery" | "remove_delivery" |
  "create_revision" | "edit_revision" | "update_revision" | "remove_revision";
type RevisionFilter = "all" | "pending" | "done";



function localTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function EditorDialog({ editor, deliveries, links, nextVersion, busy, error, close, save }: {
  editor: Editor; deliveries: Delivery[]; links: DeliveryLink[]; nextVersion:number;
  busy: boolean; error: string; close: () => void; save: (data: FormData) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [inputError, setInputError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  const [linkSource, setLinkSource] = useState(() => {
    if (editor.type !== "delivery") return "none";
    if (editor.record?.link_id || editor.linkId) return "saved";
    return editor.record ? "none" : "paste";
  });
  const linkedVersion = editor.type === "revision" && !editor.record && editor.deliveryId
    ? deliveries.find((delivery) => delivery.id === editor.deliveryId) : undefined;
  const withdrawing = editor.type === "remove-delivery";
  const removing = editor.type === "remove-revision";
  const removingRecord = withdrawing || removing;
  const title = editor.type === "delivery"
    ? editor.record ? labels.editDelivery + " V" + editor.record.version : ui.version(nextVersion)
    : editor.type === "revision"
      ? editor.record ? labels.editRevision : linkedVersion ? ui.revisionForVersion(linkedVersion.version) : labels.addRevision
      : withdrawing ? labels.removeDelivery + " V" + editor.record.version : labels.removeRevision;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (editor.type === "delivery") {
      const date = new Date(String(values.get("delivery-date") ?? ""));
      if (!Number.isFinite(date.getTime())) { setInputError(labels.invalidDate); return; }
      values.set("delivery-date", date.toISOString());
    }
    setInputError("");
    void save(values);
  }

  return <dialog ref={dialog} aria-labelledby="workflow-title" onCancel={(event) => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <form onSubmit={handleSubmit}>
      <h2 id="workflow-title">{title}</h2>
      {editor.type === "delivery" && <>
        <label>{labels.deliveryLink}<select value={linkSource} onChange={(event) => setLinkSource(event.target.value)}>
          <option value="paste">{ui.pasteLink}</option>
          {(links.length > 0 || editor.record?.link_id) && <option value="saved">{ui.useSavedLink}</option>}
          <option value="none">{ui.noLinkDelivery}</option>
        </select></label>
        {linkSource === "paste" && <label>{ui.deliveryUrl}<input name="link-url" type="url" placeholder="https://…" required autoFocus/></label>}
        {linkSource === "saved" && <label>{ui.savedLink}<select name="link" required defaultValue={editor.record?.link_id ?? editor.linkId ?? ""}>
          <option value="">{ui.chooseLink}</option>
          {editor.record?.link_id && !links.some((link) => link.id === editor.record?.link_id) &&
            <option value={editor.record.link_id}>{labels.unavailableLink}</option>}
          {links.map((link) => <option key={link.id} value={link.id}>{link.title}</option>)}
        </select></label>}
        <label>{labels.deliveryDate}<input type="datetime-local" name="delivery-date" step="1" required
          defaultValue={localTime(editor.record?.delivered_at)}/></label>
        <label>{es.label.notes}<textarea name="notes" defaultValue={editor.record?.notes ?? ""} rows={4}/></label>
      </>}
      {editor.type === "revision" && <>
        <label>{labels.change}<textarea name="text" autoFocus required defaultValue={editor.record?.text ?? ""} rows={4}/></label>
        {linkedVersion ? <>
          <p className="muted">{ui.linkedRevision(linkedVersion.version)}</p>
          <input type="hidden" name="delivery" value={linkedVersion.id}/>
        </> : <label>{labels.deliveryVersion}<select name="delivery" defaultValue={editor.record?.delivery_id ?? editor.deliveryId ?? ""}>
          <option value="">{labels.generalRevision}</option>
          {editor.record?.delivery_withdrawn === 1 && editor.record.delivery_id &&
            <option value={editor.record.delivery_id}>V{editor.record.delivery_version} · {labels.withdrawn}</option>}
          {deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>V{delivery.version}</option>)}
        </select></label>}
      </>}
      {withdrawing && <p className="muted">{labels.removeDeliveryHint}</p>}
      {removing && <><p className="notes">{editor.record.text}</p><p className="muted">{labels.removeRevisionHint}</p></>}
      {(error || inputError) && <p role="alert">{error || inputError}</p>}
      <div className="actions">
        <button type="button" onClick={close} disabled={busy} autoFocus={removingRecord}>{es.cancel}</button>
        <button className={removingRecord ? "danger-button" : "primary"} disabled={busy}>
          {withdrawing ? labels.withdraw : removing ? labels.delete : es.save}
        </button>
      </div>
    </form>
  </dialog>;
}

export function ProjectControl({ id, links, children, refresh, status, onStatus }: {
  id: string;
  links: DeliveryLink[];
  status:keyof typeof es.status;
  onStatus:(status:SuggestedStatus) => void;
  children: (summary: { openRevisions?:number; linkedIds:Set<string>; workflow:ReactNode; feedback:ReactNode; dialog:ReactNode; registerLink?: (id:string) => void;
    latest?:number; nextVersion:number; activityCount:number; busy:boolean; addDelivery:() => void; addRevision:() => void }) => ReactNode;
  refresh: () => Promise<void>;
}) {
  const [details, setDetails] = useState<Details>();
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [suggestion, setSuggestion] = useState<SuggestedStatus>();
  const [filter, setFilter] = useState<RevisionFilter>("all");

  useEffect(() => {
    let active = true;
    void invoke<Details>("project_details", { id }).then((value) => {
      if (active) setDetails(value);
    }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [id]);

  function open(value: Editor) {
    setModalError("");
    setEditor(value);
  }

  async function write(command: WriteCommand, args: object, dialog = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    setModalError("");
    setNotice("");
    let applied = false;
    try {
      await invoke(command, args);
      applied = true;
      if (dialog) setEditor(undefined);
      if (command === "create_revision" && filter === "done") setFilter("pending");
      const updated = await invoke<Details>("project_details", { id });
      setDetails(updated);
      if (command === "create_delivery") setSuggestion("delivered");
      if (command === "create_revision") setSuggestion("changes_requested");
      if (command === "update_revision" && updated.revisions.every((review) => review.done)) setSuggestion("approved");
      if (command === "update_revision" && updated.revisions.some((review) => !review.done))
        setSuggestion((current) => current === "approved" ? undefined : current);
      if (command === "create_delivery" || command === "edit_delivery") await refresh();
      setNotice(es.saved);
    } catch (reason) {
      if (dialog && !applied) setModalError(String(reason));
      else setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor(data: FormData) {
    if (!editor) return;
    if (editor.type === "delivery") {
      const args = { linkId:data.get("link"), linkUrl:data.get("link-url"), deliveredAt:data.get("delivery-date"), notes:data.get("notes") };
      if (editor.record) await write("edit_delivery", { ...args, projectId:id, id:editor.record.id }, true);
      else await write("create_delivery", { ...args, id }, true);
    } else if (editor.type === "revision") {
      const args = { deliveryId:data.get("delivery"), text:data.get("text") };
      if (editor.record) await write("edit_revision", { ...args, projectId:id, id:editor.record.id }, true);
      else await write("create_revision", { ...args, id }, true);
    } else {
      await write(editor.type === "remove-delivery" ? "remove_delivery" : "remove_revision",
        { projectId:id, id:editor.record.id }, true);
    }
  }

  function linkAction(command: "open_link" | "copy_link", url: string) {
    setError("");
    void invoke(command, { url }).then(() => {
      if (command === "copy_link") setNotice(es.copyDone);
    }).catch((reason) => setError(String(reason)));
  }

  const { deliveries = [], revisions = [] } = details ?? {};
  const completed = revisions.filter((revision) => revision.done).length;
  const visible = revisions.filter((revision) => revisions.length < 2 || filter === "all" || (filter === "done") === Boolean(revision.done))
    .sort((a,b) => a.done-b.done);

  function revisionRows(rows:Revision[], showVersion = false) {
    return <ul className="list control-list">
    {rows.map((revision) => <li key={revision.id} className="revision-row">
      <input type="checkbox" checked={Boolean(revision.done)} disabled={busy} aria-label={labels.markRevision(revision.text)}
        onChange={(event) => void write("update_revision", { id:revision.id, projectId:id, done:event.target.checked })}/>
      <div className="revision-body">
        <p className="notes">{revision.text}</p>
        <div className="muted delivery-meta">
          {showVersion && revision.delivery_version && <span>{"V" + revision.delivery_version + (revision.delivery_withdrawn ? " · " + labels.withdrawn : "")}</span>}
          <span>{revision.done && revision.done_at ? labels.completedAt + " " + formatDate(revision.done_at,true)
            : labels.reportedAt + " " + formatDate(revision.created_at,true)}</span>
          {revision.updated_at && <span title={formatDate(revision.updated_at,true)}>{labels.edited}</span>}
        </div>
      </div>
      <ActionMenu>
        <button disabled={busy} onClick={() => open({ type:"revision", record:revision })}>{es.editAction}</button>
        <button disabled={busy} onClick={() => open({ type:"remove-revision", record:revision })}>{labels.delete}</button>
      </ActionMenu>
    </li>)}
    </ul>;
  }

  function revisionGroup(rows:Revision[], showVersion = false) {
    const pending = rows.filter((review) => !review.done);
    const resolved = rows.filter((review) => review.done);
    return <>
      {pending.length > 0 && revisionRows(pending, showVersion)}
      {resolved.length > 0 && <details key={filter} className="resolved-revisions" open={filter === "done"}>
        <summary>{labels.completedCount(resolved.length)}</summary>
        {revisionRows(resolved, showVersion)}
      </details>}
    </>;
  }

  const general = visible.filter((review) => !review.delivery_id);
  const retired = visible.filter((review) => review.delivery_id && !deliveries.some(({ id }) => id === review.delivery_id));
  const workflow =
    <div className="project-control">
      {!details && !error && <Skeleton label={ui.loadingActivity}/>}
      {details && <section className="overview-card workflow-card">
        <div className="workflow-heading">
          <h2>{ui.activity}</h2>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => open({ type:"delivery" })}>{ui.version(details.nextVersion)}</button>
            <button className="secondary" disabled={busy} onClick={() => open({ type:"revision" })}>{ui.general}</button>
          </div>
        </div>
        {revisions.length >= 2 && <div className="actions revision-filters" role="group" aria-label={labels.filterRevisions}>
          {Object.entries(labels.revisionFilters).map(([key, text]) => <button key={key} aria-pressed={filter === key}
            onClick={() => setFilter(key as RevisionFilter)}>{text}</button>)}
        </div>}
        {revisions.length > 0 && !visible.length && <p className="muted">{labels.noMatchingRevisions}</p>}
        {!deliveries.length && !revisions.length && <div className="activity-empty">
          <ol>{ui.emptySteps.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="muted">{ui.emptyActivity}</p>
        </div>}
        <ol className="delivery-history">
          {deliveries.map((delivery, index) => {
            const link = links.find((item) => item.id === delivery.link_id);
            const pending = revisions.filter((revision) => revision.delivery_id === delivery.id && !revision.done).length;
            const nested = visible.filter((revision) => revision.delivery_id === delivery.id);
            return <li key={delivery.id} className="delivery-item" data-has-revisions={nested.length > 0}>
              <span className="version-mark">V{delivery.version}</span>
              <div className="delivery-body">
                <div className="delivery-heading">
                  <strong>{ui.versionTitle(delivery.version)}</strong>
                  {index === 0 && <Chip tone="info">{labels.latest}</Chip>}
                </div>
                <div className="muted delivery-meta"><time dateTime={delivery.delivered_at}>{formatDate(delivery.delivered_at,true)}</time>
                  {link && <span title={link.title}>{link.title} · {es.service[link.service ?? "generic"]}</span>}
                  {delivery.updated_at && <span title={formatDate(delivery.updated_at,true)}>{labels.edited}</span>}
                  {pending > 0 && <Chip tone="warning">{labels.pendingCount(pending)}</Chip>}
                  {!link && <span>{delivery.link_id ? labels.unavailableLink : labels.unlinked}</span>}
                </div>
                {delivery.notes && <p className="notes delivery-notes">{delivery.notes}</p>}
                <div className="actions">
                  {link && <button disabled={busy} onClick={() => linkAction("open_link", link.url)}>{ui.openLink}</button>}
                  <button disabled={busy} onClick={() => open({ type:"revision", deliveryId:delivery.id })}>{ui.changes}</button>
                  <ActionMenu>
                    {link && <button disabled={busy} onClick={() => linkAction("copy_link", link.url)}>{labels.copyDelivery}</button>}
                    <button disabled={busy} onClick={() => open({ type:"delivery", record:delivery })}>{es.editAction}</button>
                    <button disabled={busy} onClick={() => open({ type:"remove-delivery", record:delivery })}>{labels.withdraw}</button>
                  </ActionMenu>
                </div>
                {nested.length > 0 && <section className="nested-revisions" aria-labelledby={"version-revisions-" + delivery.id}>
                  <h3 id={"version-revisions-" + delivery.id}>{ui.versionRevisions(delivery.version)}</h3>
                  {revisionGroup(nested)}
                </section>}
              </div>
            </li>;
          })}
        </ol>
        {general.length > 0 && <section className="revision-group"><h3>{ui.generalGroup}</h3>{revisionGroup(general)}</section>}
        {retired.length > 0 && <section className="revision-group"><h3>{ui.retiredGroup}</h3>{revisionGroup(retired,true)}</section>}
      </section>}
    </div>;

  return children({
    workflow, feedback:<>
      <Toasts notice={notice} error={error} clearNotice={() => setNotice("")} clearError={() => setError("")}/>
      {suggestion && suggestion !== status && <div className="suggestion overview-card" role="status">
        <span>{ui.suggestions[suggestion]}</span>
        <div className="actions">
          <button className="primary" onClick={() => { onStatus(suggestion); setSuggestion(undefined); }}>{ui.confirm}</button>
          <button className="ghost" onClick={() => setSuggestion(undefined)}>{ui.dismiss}</button>
        </div>
      </div>}
    </>, dialog:editor && <EditorDialog editor={editor} deliveries={deliveries} links={links} nextVersion={details?.nextVersion ?? 1} busy={busy}
        error={modalError} close={() => setEditor(undefined)} save={saveEditor}/>,
    latest:deliveries[0]?.version, nextVersion:details?.nextVersion ?? 1,
    activityCount:deliveries.length + revisions.length, busy:!details || busy,
    addDelivery:() => open({ type:"delivery" }),
    addRevision:() => open({ type:"revision", deliveryId:deliveries[0]?.id }),
    openRevisions:details ? revisions.length - completed : undefined,
    linkedIds:new Set(deliveries.flatMap(({ link_id }) => link_id ? [link_id] : [])),
    registerLink:details && !busy ? (linkId) => open({ type:"delivery", linkId }) : undefined,
  });
}

export function LinkPassword({ id, stored, onChange }: { id: string; stored: boolean; onChange: () => Promise<void> }) {
  const [entered, setEntered] = useState("");
  const [visible, setVisible] = useState<string>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const labels = es.control;
  async function operation(action: "set" | "get" | "copy" | "delete") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const result = await invoke<string | undefined>("link_secret", { id, action, password:action === "set" ? entered : undefined });
      if (action === "get") setVisible(result);
      if (action === "copy") setMessage(labels.passwordCopied);
      if (action === "set" || action === "delete") {
        setVisible(undefined);
        setEntered("");
        await onChange();
        setMessage(es.saved);
      }
    } catch (reason) {
      setError(true);
      setMessage(String(reason));
    } finally {
      setBusy(false);
    }
  }
  return <details className="password-panel" onToggle={(event) => { if (!event.currentTarget.open) setVisible(undefined); }}>
    <summary>{labels.password}</summary>
    <form onSubmit={(event) => { event.preventDefault(); void operation("set"); }}>
      <label>{labels.newPassword}<input type="password" autoComplete="new-password" value={entered} maxLength={1280}
        onChange={(event) => setEntered(event.target.value)} required/></label>
      <button disabled={busy || !entered}>{es.save}</button>
    </form>
    {stored && <div className="actions">
      <button disabled={busy} onClick={() => visible === undefined ? void operation("get") : setVisible(undefined)}>{visible === undefined ? labels.reveal : labels.hide}</button>
      <button disabled={busy} onClick={() => void operation("copy")}>{es.copy}</button>
      <button disabled={busy} onClick={() => { if (window.confirm(labels.deletePassword)) void operation("delete"); }}>{labels.remove}</button>
    </div>}
    {visible !== undefined && <output className="secret-value">{visible}</output>}
    {message && <p role={error ? "alert" : "status"}>{message}</p>}
  </details>;
}
