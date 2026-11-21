import { agendaDayOffset, agendaGroups, calendarDate } from "./agenda-domain";
import { es } from "./strings";
import { Chip, formatDate, statusTone } from "./ui";

type Project = { id:string; client_id:string; title:string; status:keyof typeof es.status; due_date?:string };
type Material = { id:string; project_id:string; title:string; kind:string; download_status:string; expires_at?:string };

export function Today({ projects, links, clients, open, warningDays }: {
  projects:Project[]; links:Material[]; clients:{ id:string; name:string }[];
  open:(id:string) => void; warningDays:number;
}) {
  const now = new Date();
  const today = calendarDate(now);
  const groups = agendaGroups(projects,links,now,warningDays);
  const names = new Map(clients.map(({ id,name }) => [id,name]));
  const byProjectId = new Map(projects.map((project) => [project.id,project]));
  const projectRows = (rows:typeof groups.today) => rows.map(({ item:project,date }) => ({ project,date,id:project.id,material:undefined }));
  const sections = [
    { id:"overdue", title:es.overdue, tone:"danger", rows:projectRows(groups.overdue) },
    { id:"today", title:es.dueToday, tone:"warning", rows:projectRows(groups.today) },
    { id:"week", title:es.dueWeek, tone:"info", rows:projectRows(groups.week) },
    { id:"materials", title:es.expiring, tone:"warning", rows:groups.materials.flatMap(({ item,date }) => {
      const project = byProjectId.get(item.project_id);
      return project ? [{ project,date,id:item.id,material:item.title }] : [];
    }) },
  ] as const;
  const empty = sections.every(({ rows }) => rows.length === 0);

  function jump(id:string) {
    const target = document.getElementById(id);
    target?.focus({ preventScroll:true });
    target?.scrollIntoView({ block:"start", behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  return <>
    <header className="agenda-heading">
      <h1>{es.nav.today}</h1>
      <p className="muted">{es.detailUi.agendaIntro}</p>
    </header>
    <div className="agenda-stats">
      {sections.map(({ id,tone,rows }) => <button type="button" key={id} data-tone={tone}
        aria-controls={empty ? "agenda-empty" : "agenda-" + id} onClick={() => jump(empty ? "agenda-empty" : "agenda-" + id)}>
        <span>{es.agenda.summary[id]}</span><strong>{rows.length}</strong>
      </button>)}
    </div>
    {empty ? <section id="agenda-empty" aria-labelledby="agenda-empty-title" tabIndex={-1} className="overview-card agenda-empty">
      <h2 id="agenda-empty-title">{es.agenda.caughtUp}</h2><p className="muted">{es.agenda.emptyHint}</p>
    </section> : <div className="today-grid">
      {[sections.slice(0,2),sections.slice(2)].map((column,index) => <div className="agenda-column" key={index}>
        {column.map(({ id,title,rows }) => <section id={"agenda-" + id} aria-labelledby={"agenda-title-" + id} tabIndex={-1} key={id}
          className={"overview-card agenda-section" + (rows.length ? "" : " agenda-section-empty")}>
          <div className="agenda-section-heading"><h2 id={"agenda-title-" + id}>{title}</h2><Chip>{rows.length}</Chip></div>
          {!rows.length ? <p className="muted">{es.detailUi.noPending}</p> : <ul className="list control-list">
            {rows.map(({ project,date,id:rowId,material }) => {
              const days = agendaDayOffset(date,today);
              return <li key={rowId}><button type="button" className="record project agenda-row" onClick={() => open(project.id)}>
                <span className="agenda-row-copy"><strong>{project.title}</strong>
                  <span className="muted">{names.get(project.client_id)}{material && " · " + material}</span>
                </span>
                <span className="agenda-row-meta">
                  <Chip tone={statusTone(project.status)}>{es.status[project.status]}</Chip>
                  <Chip tone={days < 0 ? "danger" : days <= 1 ? "warning" : "info"}>{es.agenda.relative(days)}</Chip>
                  <time className="muted stable-date" dateTime={date}>{formatDate(date)}</time>
                </span>
              </button></li>;
            })}
          </ul>}
        </section>)}
      </div>)}
    </div>}
  </>;
}
