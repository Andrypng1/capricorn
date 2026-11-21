import { useEffect, useRef, useState } from "react";
import { formatDate, formatUsd } from "./ui";
import { invoke } from "./desktop";
import { InvoicePreview, InvoiceStyleOptions, previewLabels } from "./invoice-preview";
import type { Receipt } from "./payments";

type Client = { id:string; name:string };
const base = { issuer:"", issuerInfo:"", accent:"#2858a4", style:"editorial", footer:"", logo:"" };
type Design = typeof base;
type Suggestion = { amount:string; fee:string; reference:string; platform:string; date:string; foreign:boolean; feeForeign:boolean; outgoing:boolean; currency:string; feeCurrency:string; text:string };

function errorMessage(reason:unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
}

function localDate() {
  const date = new Date();
  return [date.getFullYear(),date.getMonth()+1,date.getDate()].map((part) => String(part).padStart(2,"0")).join("-");
}

export function Invoices({ clients, receipts }: { clients:Client[]; receipts:Receipt[] }) {
  const [design,setDesign] = useState<Design>(base);
  const [client,setClient] = useState("");
  const [payment,setPayment] = useState("");
  const [form,setForm] = useState({
    number:"F-" + localDate().replaceAll("-","") + "-" + Date.now().toString(36).toUpperCase(),
    customer:"", date:localDate(), concept:"", notes:"", amount:"", fee:"", platform:"", reference:"",
  });
  const [detected,setDetected] = useState<Suggestion>();
  const [source,setSource] = useState("");
  const [preview,setPreview] = useState("");
  const [previewOpen,setPreviewOpen] = useState(false);
  const [previewError,setPreviewError] = useState("");
  const [previewLoading,setPreviewLoading] = useState(false);
  const [canPin,setCanPin] = useState(() => matchMedia("(min-width: 1100px)").matches);
  const [pinRequested,setPinRequested] = useState(false);
  const pinned = canPin && pinRequested;
  const editor = useRef<HTMLDivElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const needsExamples = [design.issuer,form.number,form.customer,form.date,form.concept,form.amount].some((value) => !value.trim());
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void invoke<Design>("invoice_template").then((value) => { if (active) setDesign(value); })
      .catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const media = matchMedia("(min-width: 1100px)");
    const update = () => setCanPin(media.matches);
    media.addEventListener("change",update);
    return () => media.removeEventListener("change",update);
  }, []);

  useEffect(() => {
    if (!previewOpen) return;
    let active = true;
    const timeout = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const html = await invoke<string>("invoice_preview",{ design,form });
        if (active) { setPreview(html); setPreviewError(""); }
      } catch (reason) {
        if (active) setPreviewError(errorMessage(reason));
      } finally {
        if (active) setPreviewLoading(false);
      }
    },300);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [previewOpen,design,form]);

  useEffect(() => {
    if (!previewOpen) return;
    function escape(event:KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setPreviewOpen(false);
      previewButton.current?.focus({ preventScroll:true });
    }
    function outside(event:MouseEvent) {
      if (pinned || !(event.target instanceof Node) || editor.current?.contains(event.target) ||
        document.getElementById("invoice-preview-panel")?.contains(event.target)) return;
      setPreviewOpen(false);
      previewButton.current?.focus({ preventScroll:true });
    }
    document.addEventListener("keydown",escape);
    document.addEventListener("click",outside);
    return () => {
      document.removeEventListener("keydown",escape);
      document.removeEventListener("click",outside);
    };
  }, [previewOpen,pinned]);

  function edit(key: keyof typeof form, value:string) {
    setForm((old) => ({ ...old,[key]:value }));
  }

  function changeDesign(key: keyof Design, value:string) {
    setDesign((old) => ({ ...old,[key]:value }));
  }

  function selectPayment(id:string) {
    setPayment(id);
    setDetected(undefined);
    const item = receipts.find((entry) => entry.id === id);
    if (!item) return;
    setForm((old) => ({
      ...old, customer:item.client_name, amount:(item.cents/100).toFixed(2), date:item.received_on,
      concept:item.project_name ?? "", notes:item.note ?? "", platform:item.platform, fee:"", reference:"",
    }));
  }

  async function run(action:() => Promise<void>) {
    if (busy) return;
    setBusy(true); setNotice(""); setError("");
    try { await action(); }
    catch (reason) {
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  }

  function read(kind:"file" | "paste" | "text") {
    void run(async () => {
      const result = await invoke<Suggestion | null>("invoice_receipt",
        kind === "paste" ? { pasted:true } : kind === "text" ? { text:source } : {});
      if (!result) return;
      setSource(result.text);
      setDetected(result);
        const held = result.foreign || result.outgoing;
      setForm((old) => ({ ...old,
        amount:held && result.amount ? "" : result.amount || old.amount,
        fee:!held && !result.feeForeign && result.fee ? result.fee : "",
        reference:result.reference, platform:result.platform || old.platform, date:result.date || old.date }));
      const warnings = [];
      if (result.outgoing) warnings.push("El importe aparece con signo negativo. Revisa si el comprobante muestra un envío.");
      if (result.foreign) warnings.push("El comprobante está en " + result.currency + ". Introduce el importe aplicable en USD.");
      if (result.feeForeign) warnings.push("La comisión detectada está en " + result.feeCurrency + ".");
      if (result.currency === "$" && !held) warnings.push("El comprobante usa $. Confirma que el importe corresponde a USD.");
      setNotice(warnings.join(" ") || (result.amount
        ? "Importe detectado. Revisa los campos antes de exportar."
        : result.text.trim() ? "Texto leído. No pude identificar un importe con suficiente claridad."
        : "No se detectó texto legible. Completa los campos manualmente."));
    });
  }

  const exportPdf = () => void run(async () => {
    if (await invoke<boolean>("invoice_export",{ design,form })) setNotice(previewLabels.saved);
  });
  const previewPanel = previewOpen && <InvoicePreview html={preview} error={previewError} loading={previewLoading}
    style={design.style} setStyle={(style) => changeDesign("style",style)} examples={needsExamples}
    pinned={pinned} canPin={canPin} togglePin={() => setPinRequested(!pinned)} busy={busy} exportPdf={exportPdf}
    close={() => { setPreviewOpen(false); previewButton.current?.focus({ preventScroll:true }); }}/>;

  return <div ref={editor} className="invoice-page">
    <header><h1>Facturas</h1></header>
    <div className={"invoice-workspace" + (previewOpen && pinned ? " invoice-workspace-pinned" : "")}>
    <div className="invoice-layout">
      <section className="overview-card invoice-card">
        <h2>Diseño de factura</h2>
        <div className="invoice-fields">
          <label>Emisor<input value={design.issuer} maxLength={120} onChange={(e) => changeDesign("issuer",e.target.value)}/></label>
          <label>Datos del emisor<textarea value={design.issuerInfo} maxLength={400} rows={2} onChange={(e) => changeDesign("issuerInfo",e.target.value)}/></label>
          <div className="control-fields">
            <label>Estilo<select value={design.style} onChange={(e) => changeDesign("style",e.target.value)}>
              <InvoiceStyleOptions/>
            </select></label>
            <label>Color de acento<input type="color" value={design.accent} onChange={(e) => changeDesign("accent",e.target.value)}/></label>
          </div>
          <label>Texto al pie<textarea value={design.footer} maxLength={400} rows={2} onChange={(e) => changeDesign("footer",e.target.value)}/></label>
          <div className="actions">
            <button disabled={busy} onClick={() => void run(async () => {
              const logo = await invoke<string | null>("invoice_logo");
              if (logo) changeDesign("logo",logo);
            })}>{design.logo ? "Cambiar logo" : "Añadir logo"}</button>
            {design.logo && <button type="button" onClick={() => changeDesign("logo","")}>Quitar logo</button>}
            <button disabled={busy} onClick={() => void run(async () => {
              setDesign(await invoke<Design>("invoice_template",{ value:design }));
              setNotice("Diseño guardado.");
            })}>Guardar diseño</button>
          </div>
        </div>
      </section>
      <section className="overview-card invoice-card">
        <h2>Datos del pago</h2>
        <div className="invoice-fields">
          <div className="actions">
            <button disabled={busy} onClick={() => read("file")}>Leer comprobante</button>
            <button disabled={busy} onClick={() => read("paste")}>Pegar captura</button>
          </div>
          {detected && <div className="invoice-detected" aria-live="polite">
            <strong>Datos detectados</strong>
            {detected.platform && <span>{detected.platform}</span>}
            {detected.amount && <span>Importe del comprobante · {detected.outgoing ? "−" : ""}{detected.amount} {detected.currency}</span>}
            {detected.fee && <span>Comisión del comprobante · {detected.fee} {detected.feeCurrency}</span>}
            {!detected.fee && <span className="muted">Comisión no indicada</span>}
          </div>}
          <details>
            <summary>Texto del comprobante</summary>
            <textarea aria-label="Texto del comprobante" rows={4} maxLength={20000} value={source} onChange={(e) => setSource(e.target.value)}/>
            <button disabled={busy || !source.trim()} onClick={() => read("text")}>Detectar datos del texto</button>
          </details>
          <label>Cliente guardado<select value={client} onChange={(e) => {
            const id=e.target.value; setClient(id); setPayment("");
            const customer = clients.find((entry) => entry.id === id)?.name ?? "";
            if (payment) {
              setForm((old) => ({ ...old, customer, concept:"", notes:"", amount:"", fee:"", platform:"", reference:"", date:localDate() }));
            } else edit("customer",customer);
          }}>
            <option value="">Escribir un cliente</option>
            {clients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select></label>
          {client && <label>Pago guardado<select value={payment} onChange={(e) => selectPayment(e.target.value)}>
            <option value="">Introducir datos manualmente</option>
            {receipts.filter((p) => p.client_id === client).map((p) => <option key={p.id} value={p.id}>
              {formatDate(p.received_on)} · {formatUsd(p.cents/100)} · {p.platform}
            </option>)}
          </select></label>}
          <label>Nombre en la factura<input value={form.customer} maxLength={140} onChange={(e) => edit("customer",e.target.value)}/></label>
          <div className="control-fields">
            <label>Número de factura<input value={form.number} maxLength={60} onChange={(e) => edit("number",e.target.value)}/></label>
            <label>Fecha<input type="date" value={form.date} onChange={(e) => edit("date",e.target.value)}/></label>
          </div>
          <label>Concepto del pago<textarea rows={2} maxLength={800} value={form.concept} onChange={(e) => edit("concept",e.target.value)}/></label>
          <div className="control-fields">
            <label>Importe (USD)<input inputMode="decimal" value={form.amount} onChange={(e) => edit("amount",e.target.value)}/></label>
            <label>Comisión (USD, opcional)<input inputMode="decimal" value={form.fee} onChange={(e) => edit("fee",e.target.value)}/></label>
          </div>
          <div className="control-fields">
            <label>Plataforma<input value={form.platform} maxLength={80} onChange={(e) => edit("platform",e.target.value)}/></label>
            <label>Número de pago o referencia<input value={form.reference} maxLength={100} onChange={(e) => edit("reference",e.target.value)}/></label>
          </div>
          <label>Notas<textarea rows={3} maxLength={1200} value={form.notes} onChange={(e) => edit("notes",e.target.value)}/></label>
        </div>
      </section>
    </div>
    {previewPanel}
    </div>
    <div className="actions invoice-actions">
      <button type="button" ref={previewButton} aria-expanded={previewOpen} aria-controls={previewOpen ? "invoice-preview-panel" : undefined}
        onClick={() => {
          if (!previewOpen) { setPreview(""); setPreviewError(""); setPreviewLoading(true); }
          setPreviewOpen(!previewOpen);
        }}>{previewLabels.open}</button>
      <button type="button" className="primary" disabled={busy} onClick={exportPdf}>{previewLabels.export}</button>
      {busy && <span role="status">Procesando…</span>}
      {notice && <span role="status" className="notice">{notice}</span>}
      {error && <span role="alert">{error}</span>}
    </div>
  </div>;
}
