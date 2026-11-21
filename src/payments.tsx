import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "./desktop";
import { Chip, formatAmount, formatDate, formatUsd, StatGrid } from "./ui";
import { es } from "./strings";

export type Receipt = { id:string; client_id:string; client_name:string; project_id:string | null; project_name:string | null;
  cents:number; platform:string; received_on:string; note:string | null };
type Client = { id:string; name:string };
type PaymentStatus = keyof typeof es.control.paymentStates;
type Project = { id:string; client_id:string; title:string; price:number | null; payment_status:PaymentStatus };
type Selection = { clientId:string; projectId:string };
const methods = ["PayPal","Binance","Wise","Transferencia bancaria","Efectivo","Stripe","Payoneer"];

function today() {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2,"0")).join("-");
}

function ReceiptEditor({ clients, projects, current, initial, close, refresh }: {
  clients:Client[]; projects:Project[]; current?:Receipt; initial?:Selection; close:() => void; refresh:() => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [clientId, setClientId] = useState(current?.client_id ?? initial?.clientId ?? (clients.length === 1 ? clients[0].id : ""));
  const [projectId, setProjectId] = useState(current?.project_id ?? initial?.projectId ?? "");
  const [method, setMethod] = useState(current && !methods.includes(current.platform) ? "custom" : current?.platform ?? "");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const clientOptions = current && !clients.some(({id}) => id === current.client_id) ?
    [...clients,{ id:current.client_id, name:current.client_name }] : clients;
  const available = projects.filter((project) => project.client_id === clientId);
  if (current?.project_id && current.client_id === clientId && !available.some(({id}) => id === current.project_id))
    available.push({ id:current.project_id, client_id:clientId, title:current.project_name ?? "Proyecto archivado", price:null, payment_status:"pending" });

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      if (removing && current) await invoke("remove_payment_receipt", { id:current.id });
      else await invoke("save_payment_receipt", {
        id:current?.id, clientId, projectId, amount:data.get("amount"),
        platform:method === "custom" ? data.get("platform") : method,
        receivedOn:data.get("date"), note:data.get("note"),
      });
      await refresh();
      close();
    } catch (reason) {
      setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ""));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} aria-labelledby="payment-editor-title" onCancel={(event) => {
    event.preventDefault(); if (!busy) close();
  }}>
    <form onSubmit={submit}>
      <h2 id="payment-editor-title">{removing ? "Eliminar pago" : current ? "Editar pago recibido" : "Registrar pago recibido"}</h2>
      {removing && current ? <p>¿Quitar el pago de {formatUsd(current.cents / 100)} del historial?</p> : <>
        <label>Cliente<select required value={clientId} onChange={(event) => { setClientId(event.target.value); setProjectId(""); }}>
          <option value="">Seleccionar cliente</option>
          {clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select></label>
        <label>Proyecto<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Sin proyecto</option>
          {available.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select></label>
        <div className="control-fields">
          <label>Importe (USD)<input name="amount" inputMode="decimal" required placeholder="0.00"
            defaultValue={current ? (current.cents / 100).toFixed(2) : ""}/></label>
          <label>Fecha de pago<input type="date" name="date" required defaultValue={current?.received_on ?? today()}/></label>
        </div>
        <label>Plataforma<select required value={method} onChange={(event) => setMethod(event.target.value)}>
          <option value="">Seleccionar plataforma</option>
          {methods.map((value) => <option key={value}>{value}</option>)}
          <option value="custom">Otra plataforma</option>
        </select></label>
        {method === "custom" && <label>Nombre de la plataforma<input name="platform" required maxLength={80}
          defaultValue={current && !methods.includes(current.platform) ? current.platform : ""}/></label>}
        <label>Referencia o nota (opcional)<textarea name="note" maxLength={500} rows={2} defaultValue={current?.note ?? ""}/></label>
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        {current && !removing && <button type="button" disabled={busy} onClick={() => setRemoving(true)}>Eliminar</button>}
        <button type="button" disabled={busy} onClick={() => removing ? setRemoving(false) : close()}>Cancelar</button>
        <button className={removing ? "danger-button" : "primary"} disabled={busy}>{removing ? "Confirmar eliminación" : "Guardar pago"}</button>
      </div>
    </form>
  </dialog>;
}

function BudgetEditor({ project, close, refresh }: {
  project:Project; close:() => void; refresh:() => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const amount = values.get("price");
    setBusy(true);
    setError("");
    try {
      await invoke("save_payment", { id:project.id, price:amount === "" ? null : Number(amount), payment_status:values.get("status") });
      await refresh();
      close();
    } catch (reason) {
      setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ""));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} aria-labelledby="budget-title" onCancel={(event) => {
    event.preventDefault(); if (!busy) close();
  }}>
    <form onSubmit={save}>
      <h2 id="budget-title">Editar presupuesto</h2>
      <p className="muted">{project.title}</p>
      <label>Presupuesto (USD)<input name="price" type="number" min="0" step="0.01" defaultValue={project.price ?? ""}/></label>
      <label>Estado del cobro<select name="status" defaultValue={project.payment_status}>
        {Object.entries(es.control.paymentStates).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button type="button" disabled={busy} onClick={close}>Cancelar</button>
        <button className="primary" disabled={busy}>Guardar presupuesto</button>
      </div>
    </form>
  </dialog>;
}

const orders = { recent:"Más recientes", oldest:"Más antiguos", highest:"Mayor importe", lowest:"Menor importe" };
type Order = keyof typeof orders;
type PaymentView = "receipts" | "budgets";
type PaymentPreferences = { view:PaymentView; order:Order; showNotes:boolean };
const preferenceKey = "capricorn.payments.view";

function loadPaymentPreferences(): PaymentPreferences {
  const defaults:PaymentPreferences = { view:"receipts", order:"recent", showNotes:true };
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
    return {
      view:saved.view === "budgets" ? "budgets" : "receipts",
      order:Object.hasOwn(orders,saved.order) ? saved.order : defaults.order,
      showNotes:saved.showNotes !== false,
    };
  } catch { return defaults; }
}

export function Payments({ receipts, clients, projects, refresh }: {
  receipts:Receipt[]; clients:Client[]; projects:Project[]; refresh:() => Promise<void>;
}) {
  const [preferences, setPreferences] = useState(loadPaymentPreferences);
  const { view, order, showNotes } = preferences;
  const [editor, setEditor] = useState<{ receipt?:Receipt }>();
  const [budget, setBudget] = useState<Project>();
  const [client, setClient] = useState("");
  const [projectId, setProjectId] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");

  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Preferences remain in memory. */ }
  }, [preferences]);

  const clientOptions = new Map(receipts.map((receipt) => [receipt.client_id, receipt.client_name]));
  for (const item of clients) clientOptions.set(item.id, item.name);
  const platformOptions = [...new Set(receipts.map((receipt) => receipt.platform))].sort((a,b) => a.localeCompare(b,"es"));
  const projectOptions = new Map<string,string>();
  if (view === "receipts") for (const receipt of receipts) {
    if (receipt.project_id && (!client || receipt.client_id === client))
      projectOptions.set(receipt.project_id,receipt.project_name ?? "Proyecto archivado");
  }
  for (const project of projects) if (!client || project.client_id === client) projectOptions.set(project.id,project.title);
  const matchesProject = (row:{ id:string; client_id:string }) => (!client || row.client_id === client) && (!projectId || row.id === projectId);
  const visible = receipts.filter((receipt) => (!client || receipt.client_id === client) &&
    (!projectId || receipt.project_id === projectId) && (!platform || receipt.platform === platform) &&
    (!from || receipt.received_on >= from) && (!until || receipt.received_on <= until));
  if (order === "oldest") visible.reverse();
  if (order === "highest") visible.sort((a,b) => b.cents - a.cents);
  if (order === "lowest") visible.sort((a,b) => a.cents - b.cents);
  const total = visible.reduce((sum, receipt) => sum + receipt.cents,0);
  const visibleBudgets = projects.filter((project) => matchesProject(project) && (!status ||
    (status === "unset" ? project.price == null : project.price != null && project.payment_status === status)))
    .sort((a,b) => a.title.localeCompare(b.title, "es"));
  const paymentProject = projects.find((project) => project.id === projectId);

  function changeView(next:PaymentView) {
    setPreferences({ ...preferences, view:next });
    if (next === "budgets" && projectId && !paymentProject) setProjectId("");
  }

  function resetFilters() {
    setClient(""); setProjectId(""); setPlatform(""); setFrom(""); setUntil(""); setStatus("");
  }

  return <section className="payment-register" aria-labelledby="payment-title">
    <div className="workflow-heading">
      <h1 id="payment-title">Pagos</h1>
      <button className="primary" disabled={!clients.length} onClick={() => setEditor({})}>Registrar pago</button>
    </div>
    <div className="actions payment-views" role="group" aria-label="Vista de pagos">
      <button type="button" aria-pressed={view === "receipts"} onClick={() => changeView("receipts")}>Pagos recibidos</button>
      <button type="button" aria-pressed={view === "budgets"} onClick={() => changeView("budgets")}>Presupuestos</button>
    </div>
    {view === "receipts" && <StatGrid items={[
      { label:es.detailUi.filteredTotal, value:formatUsd(total / 100), tone:"info" },
      { label:es.detailUi.receiptCount, value:visible.length, tone:"success" },
    ]}/>}
    <div className="payment-filters">
      <label>Cliente<select value={client} title={clientOptions.get(client) ?? es.detailUi.allClients} onChange={(event) => { setClient(event.target.value); setProjectId(""); }}>
        <option value="">Todos los clientes</option>
        {[...clientOptions].map(([id,name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Proyecto<select value={projectId} title={projectOptions.get(projectId) ?? es.detailUi.allProjects} onChange={(event) => setProjectId(event.target.value)}>
        <option value="">Todos los proyectos</option>
        {[...projectOptions].map(([id,title]) => <option key={id} value={id}>{title}</option>)}
      </select></label>
      {view === "receipts" ? <>
        <label>Plataforma<select value={platform} title={platform || es.detailUi.allPlatforms} onChange={(event) => setPlatform(event.target.value)}>
          <option value="">Todas las plataformas</option>
          {platformOptions.map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <label>Desde<input type="date" value={from} max={until || undefined} onChange={(event) => setFrom(event.target.value)}/></label>
        <label>Hasta<input type="date" value={until} min={from || undefined} onChange={(event) => setUntil(event.target.value)}/></label>
      </> : <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">Todos los estados</option>
        <option value="unset">Sin presupuesto</option>
        {Object.entries(es.control.paymentStates).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
    </div>
    <div className="actions payment-display">
      {view === "receipts" && <>
        <label>Orden<select value={order} onChange={(event) => setPreferences({ ...preferences, order:event.target.value as Order })}>
          {Object.entries(orders).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="payment-notes-toggle"><input type="checkbox" checked={showNotes}
          onChange={(event) => setPreferences({ ...preferences, showNotes:event.target.checked })}/> Mostrar referencias y notas</label>
      </>}
      <button type="button" onClick={resetFilters}>Limpiar filtros</button>
    </div>
    {view === "receipts" ? <>
      <p className="payment-total" role="status"><strong>{formatUsd(total / 100)}</strong> · {visible.length} {visible.length === 1 ? "pago" : "pagos"}</p>
      {!visible.length && <p className="muted">{receipts.length ? "No hay pagos con estos filtros." : "Todavía no hay pagos registrados."}</p>}
      <ul className="list control-list">
        {visible.map((receipt) => <li className="record payment-row" key={receipt.id}>
          <div className="record-text">
            <strong>{receipt.client_name}{receipt.project_name && " · " + receipt.project_name}</strong>
            <div className="muted"><time dateTime={receipt.received_on} className="stable-date">{formatDate(receipt.received_on)}</time> · {receipt.platform}</div>
            {showNotes && receipt.note && <p className="notes">{receipt.note}</p>}
          </div>
          <strong className="payment-amount">{formatUsd(receipt.cents / 100)}</strong>
          <button type="button" onClick={() => setEditor({ receipt })}>Editar</button>
        </li>)}
      </ul>
    </> : <>
      {!visibleBudgets.length && <p className="muted">No hay proyectos con estos filtros.</p>}
      <ul className="list control-list">
        {visibleBudgets.map((project) => <li className="record payment-row" key={project.id}>
          <div className="record-text"><strong>{project.title}</strong><div className="muted">{clientOptions.get(project.client_id)}</div></div>
          <div>
            <strong className="payment-amount">{project.price == null ? "Sin presupuesto" : formatUsd(project.price)}</strong>
            {project.price != null && <div className="muted">{es.control.paymentStates[project.payment_status]}</div>}
          </div>
          <button type="button" onClick={() => setBudget(project)}>{project.price == null ? "Añadir presupuesto" : "Editar presupuesto"}</button>
        </li>)}
      </ul>
    </>}
    {editor && <ReceiptEditor clients={clients} projects={projects} current={editor.receipt}
      initial={client || paymentProject ? { clientId:paymentProject?.client_id ?? client, projectId:paymentProject?.id ?? "" } : undefined}
      close={() => setEditor(undefined)} refresh={refresh}/>}
    {budget && <BudgetEditor project={budget} close={() => setBudget(undefined)} refresh={refresh}/>}
  </section>;
}

export function ProjectPayment({ project, receipts, clients, projects, refresh }: {
  project:Project; receipts:Receipt[]; clients:Client[]; projects:Project[]; refresh:() => Promise<void>;
}) {
  const [editor, setEditor] = useState<{receipt?:Receipt}>();
  const rows = receipts.filter((receipt) => receipt.project_id === project.id);
  const cents = rows.reduce((sum, receipt) => sum + receipt.cents, 0);
  const budget = project.price == null ? undefined : Math.round(project.price * 100);
  const ui = es.detailUi;
  const status = budget !== undefined && cents > 0 ? cents >= budget ? "paid" : "partial" : project.payment_status;
  return <section className="overview-card compact-payment">
    <div className="workflow-heading"><h2>{es.nav.payments}</h2>
      <Chip tone={status === "paid" ? "success" : "warning"}>{es.control.paymentStates[status]}</Chip>
    </div>
    <p>{ui.amounts(formatAmount(cents / 100), budget === undefined ? undefined : formatAmount(budget / 100))}</p>
    {budget !== undefined && budget > 0 && <progress aria-label={es.nav.payments} value={Math.min(cents,budget)} max={budget}/>}
    <button className={budget !== undefined && cents < budget && status !== "paid" ? "primary" : undefined}
      disabled={!clients.some(({ id }) => id === project.client_id)} onClick={() => setEditor({})}>{ui.recordPayment}</button>
    <details>
      <summary>{ui.receipts} · {rows.length}</summary>
      {!rows.length && <p className="muted">{ui.noReceipts}</p>}
      <ul className="list">{rows.map((receipt) => <li key={receipt.id}>
        <time dateTime={receipt.received_on} className="stable-date">{formatDate(receipt.received_on)}</time> · {receipt.platform} · {formatUsd(receipt.cents / 100)}
        {receipt.note && <p className="notes">{receipt.note}</p>}
        <button onClick={() => setEditor({ receipt })}>{es.editAction}</button>
      </li>)}</ul>
    </details>
    {editor && <ReceiptEditor clients={clients} projects={projects} current={editor.receipt}
      initial={{ clientId:project.client_id, projectId:project.id }} refresh={refresh} close={() => setEditor(undefined)}/>}
  </section>;
}

export function ClientCount({ count }: { count:number }) {
  return <div className="client-counter" key={count} role="status">
    <span className="zodiac-medal" aria-hidden="true"><img src={import.meta.env.BASE_URL + "capricorn-symbol.png"} alt="" width={29} height={29}/></span>
    <span><strong>{count}</strong> {count === 1 ? "cliente activo" : "clientes activos"}</span>
  </div>;
}