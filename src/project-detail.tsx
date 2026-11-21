import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { es } from "./strings";
import { ActionMenu, Chip, dueLabel, formatDate, statusTone } from "./ui";

const ui = es.detailUi;
type Status = keyof typeof es.status;

export function ProjectDetail({ title, clientName, projectType, avatar, status, date, latest, pending, paidStatus, busy, nextVersion,
  activityCount, linkCount, activity, material, sidebar, actions, feedback, dialog, onBack, onStatus, addDelivery, addRevision }: {
  title:string; clientName:string; projectType:string; avatar:ReactNode; status:Status; date?:string; latest?:number; pending?:number;
  paidStatus?:keyof typeof es.control.paymentStates; busy:boolean; nextVersion:number; activityCount:number; linkCount:number;
  activity:ReactNode; material:ReactNode; sidebar:ReactNode; actions:ReactNode; feedback:ReactNode; dialog:ReactNode;
  onBack:() => void; onStatus:(status:Status) => void; addDelivery:() => void; addRevision:() => void;
}) {
  const [tab, setTab] = useState<"activity" | "material">("activity");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const due = dueLabel(date);
  const reviewing = status === "review" || status === "changes_requested";
  const primaryText = reviewing ? es.control.addRevision : status === "approved" ? ui.final : ui.version(nextVersion);

  return <>
    <nav className="breadcrumbs" aria-label={es.nav.projects}>
      <button className="ghost" onClick={onBack}>{es.nav.projects}</button><span aria-hidden="true">/</span>
      <span>{clientName}</span><span aria-hidden="true">/</span><span aria-current="page">{title}</span>
    </nav>
    <header className="project-detail-heading">
      <div className="project-client-heading">{avatar}<div className="project-title-copy">
        <h1 title={title}>{title}</h1>
        <div className="muted" title={[clientName, projectType].filter(Boolean).join(" · ")}>{[clientName, projectType].filter(Boolean).join(" · ")}</div>
      </div></div>
      <div className="actions project-heading-actions">
        <select className="pill status-select" data-tone={statusTone(status)} aria-label={es.changeStatus} value={status}
          onChange={(event) => onStatus(event.target.value as Status)}>
          {Object.entries(es.status).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button className="primary" disabled={busy} onClick={reviewing ? addRevision : addDelivery}>{primaryText}</button>
        <ActionMenu>{actions}</ActionMenu>
      </div>
    </header>
    <div className="project-summary-strip">
      <Chip tone={due.overdue && status !== "delivered" && status !== "archived" ? "danger" : undefined}>
        {date ? <time dateTime={date} title={es.label.due_date + " · " + formatDate(date)}>{due.overdue && (status === "delivered" || status === "archived") ? formatDate(date) : due.text}</time> : due.text}
      </Chip>
      <Chip>{latest ? ui.latest(latest) : ui.noVersion}</Chip>
      <Chip tone={pending ? "warning" : undefined}>{pending === undefined ? "—" : es.control.pendingCount(pending)}</Chip>
      {paidStatus && <Chip tone={paidStatus === "paid" ? "success" : "warning"}>{es.control.paymentStates[paidStatus]}</Chip>}
    </div>
    <div className="project-feedback">{feedback}</div>
    <div className="motion-choice project-tabs" role="tablist" aria-label={es.nav.projects}
      style={{ "--active-choice":tab === "activity" ? 0 : 1 } as CSSProperties}
      onKeyDown={(event) => {
        if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : Number(tab === "activity");
        setTab(next === 0 ? "activity" : "material");
        tabRefs.current[next]?.focus();
      }}>
      {(["activity","material"] as const).map((value,index) => <button key={value}
        ref={(element) => { tabRefs.current[index] = element; }} id={"project-tab-" + value} role="tab"
        aria-selected={tab === value} aria-controls={"project-panel-" + value} aria-pressed={tab === value}
        tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>
        {ui[value]} <span>{value === "activity" ? activityCount : linkCount}</span>
      </button>)}
    </div>
    <div hidden={tab !== "activity"} role="tabpanel" id="project-panel-activity" aria-labelledby="project-tab-activity">
      <div className="project-detail-layout">
        <div className="project-detail-main">{activity}</div>
        <div className="project-detail-sidebar">{sidebar}</div>
      </div>
    </div>
    <div className="project-detail-main" hidden={tab !== "material"} role="tabpanel"
      id="project-panel-material" aria-labelledby="project-tab-material">{material}</div>
    {dialog}
  </>;
}
