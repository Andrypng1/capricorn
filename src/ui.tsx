import { useEffect, useRef, type ReactNode } from "react";
import { es } from "./strings";

export function Chip({ children, tone }: { children:ReactNode; tone?: "success" | "warning" | "danger" | "info" }) {
  return <span className="pill" data-tone={tone}>{children}</span>;
}

export function ActionMenu({ children }: { children:ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  useEffect(() => {
    function outside(event:PointerEvent) {
      if (menu.current?.open && !event.composedPath().includes(menu.current)) menu.current.open = false;
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <details ref={menu} className="action-menu" onKeyDown={(event) => {
    if (event.key === "Escape" && menu.current?.open) {
      event.preventDefault();
      event.stopPropagation();
      menu.current.open = false;
      trigger.current?.focus();
    }
  }}>
    <summary ref={trigger} className="icon-button" aria-label={es.detailUi.more}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
    </summary>
    <div className="menu-items" onClick={(event) => {
      if (event.target instanceof Element && event.target.closest("button") && menu.current) {
        menu.current.open = false;
        trigger.current?.focus();
      }
    }}>{children}</div>
  </details>;
}

export function Skeleton({ label }: { label:string }) {
  return <div className="skeleton" role="status" aria-label={label}><span/><span/><span/></div>;
}

export function Toasts({ notice, error, clearNotice, clearError }: {
  notice:string; error:string; clearNotice:() => void; clearError:() => void;
}) {
  const clearNoticeRef = useRef(clearNotice);
  useEffect(() => { clearNoticeRef.current = clearNotice; }, [clearNotice]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => clearNoticeRef.current(), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return <div className="toast-stack" aria-label={es.detailUi.alerts}>
    <div aria-live="polite">{notice && <div className="toast" data-tone="success">
      {notice}<button className="icon-button" onClick={clearNotice} aria-label={es.detailUi.close}>×</button>
    </div>}</div>
    <div aria-live="assertive">{error && <div className="toast" data-tone="danger">
      {error}<button className="icon-button" onClick={clearError} aria-label={es.detailUi.close}>×</button>
    </div>}</div>
  </div>;
}

export function dueLabel(date: string | undefined, today = new Date()) {
  if (!date) return { text:es.detailUi.noDate, overdue:false };
  const due = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(due)) return { text:es.detailUi.noDate, overdue:false };
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due - now) / 86400000);
  return { overdue:days < 0, text:days < 0 ? es.detailUi.overdue : days === 0 ? es.detailUi.today : es.detailUi.relative(days) };
}

export function statusTone(status: keyof typeof es.status) {
  if (status === "delivered" || status === "approved") return "success";
  if (status === "changes_requested") return "warning";
  if (status === "editing" || status === "review") return "info";
}

const navPaths:Record<keyof typeof es.nav, string> = {
  today:"M4 12h4l3-7 3 14 3-7h3",
  projects:"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  clients:"M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m10-12a4 4 0 1 1-8 0 4 4 0 0 1 8 0m6 12v-2a4 4 0 0 0-3-4",
  payments:"M3 6h18v12H3zM3 10h18m-14 4h3",
  invoices:"M6 3h8l4 4v14H6zm8 0v5h4M9 12h6m-6 4h6",
  settings:"M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4",
};

export function NavIcon({ name }: { name:keyof typeof es.nav }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={navPaths[name]}/></svg>;
}

export function StatGrid({ items }: { items:{ label:string; value:ReactNode; tone?:"success" | "warning" | "danger" | "info" }[] }) {
  return <dl className="stats-grid">
    {items.map(({ label, value, tone }) => <div key={label} className="overview-card" data-tone={tone}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>)}
  </dl>;
}

export function ProjectTags({ status, date, payment, showStatus = true }: {
  status:keyof typeof es.status; date?:string; payment?:keyof typeof es.control.paymentStates; showStatus?:boolean;
}) {
  const due = dueLabel(date);
  const done = status === "delivered" || status === "archived";
  return <span className="project-tags">
    {showStatus && <Chip tone={statusTone(status)}>{es.status[status]}</Chip>}
    {date && <Chip tone={due.overdue && !done ? "danger" : undefined}><time dateTime={date} title={formatDate(date)}>{due.overdue && done ? formatDate(date) : due.text}</time></Chip>}
    {payment && <Chip tone={payment === "paid" ? "success" : "warning"}>{es.control.paymentStates[payment]}</Chip>}
  </span>;
}

const shortDate = new Intl.DateTimeFormat("es", { dateStyle:"medium" });
const shortDateTime = new Intl.DateTimeFormat("es", { dateStyle:"medium", timeStyle:"short" });
const money = new Intl.NumberFormat("es", { minimumFractionDigits:2, maximumFractionDigits:2 });

export function formatDate(value: string, withTime = false) {
  const date = new Date(value.length === 10 ? value + "T00:00:00" : value);
  return Number.isFinite(date.getTime()) ? (withTime ? shortDateTime : shortDate).format(date) : value;
}

export function formatAmount(value: number) {
  return money.format(value);
}

export function formatUsd(value: number) {
  return formatAmount(value) + " USD";
}
