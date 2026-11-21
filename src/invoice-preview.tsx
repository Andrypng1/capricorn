import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { es } from "./strings";

export const previewLabels = es.invoicePreview;

export function InvoiceStyleOptions() {
  return <>{Object.entries(previewLabels.styles).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</>;
}

const paperWidth = 210 * 96 / 25.4;
const paperHeight = 297 * 96 / 25.4;

function PreviewPaper({ html }: { html:string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale,setScale] = useState(0);
  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width,height } = entry.contentRect;
      setScale(Math.min(width / paperWidth,height / paperHeight,1));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="invoice-paper-viewport" ref={viewport}>
    <div className="invoice-paper" style={{ width:paperWidth * scale, height:paperHeight * scale }}>
      <iframe sandbox="" title={previewLabels.title} srcDoc={html} tabIndex={-1}
        style={{ width:paperWidth, height:paperHeight, "--invoice-scale":scale } as CSSProperties}/>
    </div>
  </div>;
}

export function InvoicePreview({ html, error, loading, style, setStyle, examples, pinned, canPin, togglePin,
  close, exportPdf, busy }: {
  html:string; error:string; loading:boolean; style:string; setStyle:(value:string) => void; examples:boolean;
  pinned:boolean; canPin:boolean; togglePin:() => void; close:() => void; exportPdf:() => void; busy:boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll:true }); }, [pinned]);
  const content:ReactNode = <section ref={panel} tabIndex={-1} id="invoice-preview-panel" role="dialog"
    aria-label={previewLabels.title} className={"overview-card invoice-popover" + (pinned ? " invoice-popover-pinned" : "")}>
    <div className="invoice-popover-heading">
      <h2>{previewLabels.title}</h2>
      <div className="actions">
        {canPin && <button type="button" aria-pressed={pinned} onClick={togglePin}>{pinned ? previewLabels.unpin : previewLabels.pin}</button>}
        <button type="button" onClick={close}>{previewLabels.close}</button>
      </div>
    </div>
    <div className="invoice-popover-toolbar">
      <label>{previewLabels.style}<select value={style} onChange={(event) => setStyle(event.target.value)}><InvoiceStyleOptions/></select></label>
      <button type="button" className="primary" disabled={busy || Boolean(error)} onClick={exportPdf}>{previewLabels.export}</button>
    </div>
    <div className="invoice-preview-status muted" role="status">
      {loading ? previewLabels.working : examples && !error ? previewLabels.samples : ""}
    </div>
    {error ? <p className="invoice-preview-error" role="alert">{error}</p>
      : html ? <PreviewPaper html={html}/> : <div className="invoice-paper-placeholder"/>}
  </section>;
  return pinned ? content : createPortal(content,document.body);
}
