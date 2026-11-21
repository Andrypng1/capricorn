import { StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "./desktop";
import { create } from "zustand";
import { BatchLinks, LinkThumbnail } from "./link-tools";
import { Today } from "./agenda";
import { calendarDate } from "./agenda-domain";
import { Invoices } from "./invoice-view";
import { ClientCount, Payments, ProjectPayment, type Receipt } from "./payments";
import { LinkPassword, ProjectControl } from "./control";
import { DataSettings, type DataPreferences } from "./data-settings";
import { AvatarDialog, ClientAvatar, ClientPortrait } from "./client-avatar";
import { SocialChips, SocialManager, type ClientSocial } from "./client-socials";
import { ProjectDetail } from "./project-detail";
import { ActionMenu, Chip, NavIcon, ProjectTags, Skeleton, Toasts } from "./ui";
import { SectionReveal } from "./section-reveal";
import { SocialApiSettings } from "./social-api-settings";
import { DesktopSettings } from "./settings";
import { es } from "./strings";
import { matches, safeUrl } from "./domain";
import "./style.css";

type Client = { id: string; name: string; email?: string; phone?: string; notes?: string; color?: string; avatar_updated?: string | null };
type Project = { id: string; client_id: string; title: string; type: string; status: keyof typeof es.status; due_date?: string; price:number | null; payment_status:keyof typeof es.control.paymentStates; local_folder?: string; notes?: string };
type Link = { id: string; project_id: string; title: string; url: string; kind: keyof typeof es.kind; service: keyof typeof es.service; health: keyof typeof es.control.health; has_password: number; has_thumbnail: number; last_checked_at?: string; expires_at?: string; download_status: keyof typeof es.download; notes?: string };
type Snapshot = { clients: Client[]; projects: Project[]; links: Link[]; socials: ClientSocial[]; payments: Receipt[] };
type Entity = keyof typeof es.new;
type Editor = { entity: Entity; current?: Client | Project | Link };
type Theme = keyof typeof es.theme;
type Palette = Exclude<keyof typeof es.palettes, "title">;
const palettes: Palette[] = ["minimal","cyberpunk","modern"];
const themeChoices: { value:Theme; icon:string }[] = [
  { value:"light", icon:"☀" }, { value:"dark", icon:"☾" }, { value:"system", icon:"◫" },
];
const sections = Object.entries(es.nav) as [keyof typeof es.nav, string][];
type Field = keyof typeof es.label;

const useRecords = create<Snapshot & { refresh: () => Promise<void> }>((set) => ({
  clients: [], projects: [], links: [], socials: [], payments: [],
  refresh: async () => set(await invoke<Snapshot>("snapshot")),
}));


function Options({ values }: { values: Record<string, string> }) {
  return Object.entries(values).map(([value, label]) => <option key={value} value={value}>{label}</option>);
}

function RecordForm({ editor, clients, projectId, close, onSave }: {
  editor: Editor; clients: Client[]; projectId?: string; close: () => void;
  onSave: (record: Record<string, string | undefined>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const { entity, current } = editor;
  const values = { ...current } as Partial<Record<Field, string>>;
  function input(name: Field, type = "text", required = false) {
    return <label>{es.label[name]}<input name={name} type={type} required={required} defaultValue={values[name] ?? (type === "color" ? "#d9aa72" : "")}/></label>;
  }
  function select(name: Field, choices: Record<string, string>) {
    return <label>{es.label[name]}<select name={name} defaultValue={values[name] ?? Object.keys(choices)[0]} required><Options values={choices}/></select></label>;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value).trim()]));
    setBusy(true);
    setError("");
    try {
      await onSave({ ...fields, id: current?.id, entity, project_id: entity === "link" ? projectId : undefined });
      close();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={submit}>
      <h2>{current ? es.edit[entity] : es.new[entity]}</h2>
      {entity === "client" && <>{input("name", "text", true)}{input("email", "email")}{input("phone", "tel")}{input("color", "color")}</>}
      {entity === "project" && <>{input("title", "text", true)}{select("client_id", Object.fromEntries(clients.map((client) => [client.id, client.name])))}{input("type")}{select("status", es.status)}{input("due_date", "date")}{input("local_folder")}</>}
      {entity === "link" && <>{input("title", "text", true)}{input("url", "url", true)}{select("kind", es.kind)}{input("expires_at", "date")}{select("download_status", es.download)}</>}
      <label>{es.label.notes}<textarea name="notes" defaultValue={values.notes ?? ""}/></label>
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={close} disabled={busy}>{es.cancel}</button><button className="primary" disabled={busy}>{es.save}</button></div>
    </form>
  </dialog>;
}

function QuickCapture({ projects, clients, close, onSave, suggestedUrl }: {
  projects: Project[]; clients: Client[]; close: () => void; suggestedUrl?: string;
  onSave: (record: Record<string, string | undefined>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(suggestedUrl ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    let active = true;
    element.showModal();
    void invoke<string>("read_clipboard").then((value) => {
      if (active && safeUrl(value)) setUrl((existing) => existing || value.trim());
    }).catch(() => undefined);
    return () => { active = false; element.close(); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    if (!safeUrl(url)) { setError(es.invalidUrl); return; }
    setBusy(true);
    setError("");
    try {
      await onSave({
        entity:"link", title:String(data.get("title")).trim() || new URL(url).hostname, url,
        project_id:String(data.get("project_id")), kind:String(data.get("kind")),
        expires_at:String(data.get("expires_at")), download_status:"pending",
      });
      close();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby="capture-heading" onCancel={(event) => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <form onSubmit={submit}>
      <h2 id="capture-heading">{es.capture}</h2>
      <label>{es.label.url}<input type="url" autoFocus value={url} onChange={(event) => setUrl(event.target.value)} required/></label>
      <label>{es.labelProject}<select name="project_id" defaultValue={projects[0]?.id ?? ""} required>
        {!projects.length && <option value="">{es.selectProject}</option>}
        {projects.map((project) => <option key={project.id} value={project.id}>
          {clients.find((client) => client.id === project.client_id)?.name} · {project.title}
        </option>)}
      </select></label>
      <label>{es.label.title}<input name="title"/></label>
      <label>{es.label.kind}<select name="kind"><Options values={es.kind}/></select></label>
      <label>{es.label.expires_at}<input name="expires_at" type="date"/></label>
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={close} disabled={busy}>{es.cancel}</button>
        <button className="primary" disabled={busy || !projects.length}>{es.captureTitle}</button></div>
    </form>
  </dialog>;
}

type Command = { id: string; label: string; keywords?: string; run: () => void };

function CommandPalette({ commands, close }: { commands: Command[]; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = commands.filter((command) => matches(query, command.label, command.keywords)).slice(0, 12);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    document.getElementById("palette-" + active)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(command: Command) {
    close();
    command.run();
  }

  return <dialog ref={dialog} aria-labelledby="palette-title" onCancel={(event) => {
    event.preventDefault();
    close();
  }}>
    <h2 id="palette-title">{es.commands}</h2>
    <input
      className="search"
      role="combobox"
      aria-label={es.commandHint}
      aria-expanded="true"
      aria-controls="palette-results"
      aria-activedescendant={results[active] ? "palette-" + active : undefined}
      autoFocus
      placeholder={es.commandHint}
      value={query}
      onChange={(event) => { setQuery(event.target.value); setActive(0); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive(Math.max(0, Math.min(results.length - 1, active + step)));
        }
        if (event.key === "Enter" && results[active]) {
          event.preventDefault();
          choose(results[active]);
        }
      }}
    />
    <div id="palette-results" role="listbox" aria-label={es.commands} className="palette-results">
      {results.map((command, index) => <div
        key={command.id} id={"palette-" + index} role="option"
        aria-selected={index === active} onClick={() => choose(command)}
      >{command.label}</div>)}
    </div>
    {results.length === 0 && <p role="status">{es.noResults}</p>}
  </dialog>;
}

function App() {
  const { clients, projects, links, socials, payments, refresh } = useRecords();
  const [page, setPage] = useState<keyof typeof es.nav>("projects");
  const [selected, setSelected] = useState<string>();
  const [findingAvatars, setFindingAvatars] = useState(false);
  const [avatarClientId, setAvatarClientId] = useState<string>();
  const [socialClientId, setSocialClientId] = useState<string>();
  const [batch, setBatch] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkService, setLinkService] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  const [linkOrder, setLinkOrder] = useState<keyof typeof es.thumbnails.orders>("recent");
  useEffect(() => { setLinkQuery(""); setLinkService(""); setLinkStatus(""); }, [selected]);
  const [projectView, setProjectView] = useState<"list" | "board">("list");
  const [clientFilter, setClientFilter] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [palette, setPalette] = useState(false);
  const [capture, setCapture] = useState<{ url?: string }>();
  useEffect(() => window.capricorn?.onShortcut((command, url) => {
    if (command === "today") { setPage("today"); setSelected(undefined); }
    if (command === "capture" && !editor && !palette && !batch && !socialClientId && !avatarClientId) setCapture({ url });
  }), [editor, palette, batch, socialClientId, avatarClientId]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!editor && !capture && !batch && !socialClientId && !avatarClientId && event.ctrlKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, capture, batch, socialClientId, avatarClientId]);
  const [days, setDays] = useState(2);
  const [checking, setChecking] = useState<string>();
  const [theme, setTheme] = useState<Theme>("dark");
  const [appearance, setPaletteChoice] = useState<Palette>("minimal");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeProjects = projects.filter(({ status }) => status !== "delivered" && status !== "archived");
  const overdueCount = activeProjects.filter(({ due_date }) => due_date && due_date < calendarDate(new Date())).length;
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const countsByClient = new Map<string,number>();
  for (const { client_id } of activeProjects) countsByClient.set(client_id, (countsByClient.get(client_id) ?? 0) + 1);
  const current = projects.find(({ id }) => id === selected);
  const projectPaidCents = current ? payments.reduce((total, receipt) => total + (receipt.project_id === current.id ? receipt.cents : 0),0) : 0;
  const paidStatus = current && (current.price == null || projectPaidCents === 0
    ? current.payment_status
    : projectPaidCents >= Math.round(current.price * 100) ? "paid" : "partial");
  const avatarClient = clients.find(({ id }) => id === avatarClientId);
  const projectClient = clients.find(({ id }) => id === current?.client_id);
  const socialClient = clients.find(({ id }) => id === socialClientId);
  const profilesByClient = useMemo(() => {
    const grouped = new Map<string, ClientSocial[]>();
    for (const profile of socials) {
      const list = grouped.get(profile.client_id) ?? [];
      list.push(profile);
      grouped.set(profile.client_id, list);
    }
    return grouped;
  }, [socials]);
  const profilesOf = (id: string) => profilesByClient.get(id) ?? [];
  const visibleClients = clients.filter((client) =>
    matches(query, client.name, client.email, client.phone, client.notes) ||
    profilesOf(client.id).some((profile) => matches(query, profile.label, profile.url, es.social.platforms[profile.platform]))
  );
  const projectLinks = links.filter(({ project_id }) => project_id === current?.id);
  const visibleLinks = projectLinks.filter((link) =>
    (projectLinks.length < 4 || !linkService || link.service === linkService) && (projectLinks.length < 4 || !linkStatus || link.download_status === linkStatus) &&
    matches(linkQuery, link.title, link.url, link.notes, es.service[link.service])
  );
  if (linkOrder === "expiry") visibleLinks.sort((a,b) => (a.expires_at || "9999").localeCompare(b.expires_at || "9999"));
  if (linkOrder === "title") visibleLinks.sort((a,b) => a.title.localeCompare(b.title, "es", { numeric:true }));

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      await refresh();
      setTheme(await invoke<Theme>("theme"));
      setPaletteChoice(await invoke<Palette>("palette"));
      setDays((await invoke<DataPreferences>("data_settings")).days);
    } catch (reason) {
      setError(es.storageError + " " + String(reason));
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = appearance;
  }, [theme, appearance]);

  async function action(run: () => Promise<unknown>, message?: string) {
    setError("");
    setNotice("");
    try {
      await run();
      if (message) setNotice(message);
    } catch (reason) {
      setError(es.error + " " + String(reason));
    }
  }
  const missingAvatars = visibleClients.filter((client) => !client.avatar_updated && profilesOf(client.id).length > 0);

  async function findClientAvatars() {
    if (findingAvatars) return;
    setFindingAvatars(true);
    setError("");
    setNotice("Buscando fotos de clientes…");
    let cursor = 0;
    let added = 0;
    let failed = 0;
    async function next() {
      while (cursor < missingAvatars.length) {
        const { id } = missingAvatars[cursor++];
        try { if (await invoke<boolean>("auto_client_avatar", { id })) added++; }
        catch { failed++; }
      }
    }
    try {
      await Promise.all([next(), next()]);
      await refresh();
      setNotice(added + (added === 1 ? " foto encontrada." : " fotos encontradas.") +
        (missingAvatars.length > added ? " Puedes pegar una imagen para los perfiles sin foto." : ""));
      if (failed) setError("Algunas fotos no pudieron comprobarse.");
    } catch (reason) {
      setError(String(reason));
    } finally { setFindingAvatars(false); }
  }
  const openSocial = (url: string) => void action(() => invoke("open_link", { url }));

  async function save(record: Record<string, string | undefined>) {
    if (record.entity === "link" && !safeUrl(record.url ?? "")) throw new Error("Usa una URL HTTP o HTTPS válida.");
    const optional = ["email", "phone", "notes", "color", "due_date", "local_folder", "expires_at"];
    for (const field of optional) if (!record[field]) delete record[field];
    const id = await invoke<string>("save", { record });
    await refresh();
    if (record.entity === "project") setSelected(id);
    setNotice(es.saved);
  }
  function archive(entity: Entity, id: string) {
    if (!window.confirm(es.archive[entity])) return;
    void action(async () => {
      await invoke("archive", { entity, id });
      await refresh();
      if (entity === "project" && selected === id) setSelected(undefined);
    }, es.archived);
  }
  function editActions(entity: Entity, item: Client | Project | Link): ReactNode {
    return <><button onClick={() => setEditor({ entity, current: item })}>{es.editAction}</button><button onClick={() => archive(entity, item.id)}>{es.archiveAction}</button></>;
  }
  const clientName = (id: string) => clients.find((client) => client.id === id)?.name ?? "";
  const visible = projects.filter((project) =>
    (!clientFilter || project.client_id === clientFilter) && (matches(query, project.title, clientName(project.client_id), project.type, project.notes) ||
    links.some((link) => link.project_id === project.id && matches(query, link.url, link.title, es.service[link.service])))
  );
  function moveProject(project: Project, status: Project["status"]) {
    if (project.status === status) return;
    void action(async () => {
      await invoke("change_project_status", { id: project.id, status });
      await refresh();
    }, es.saved);
  }
  function navigate(next: keyof typeof es.nav) {
    setPage(next);
    setSelected(undefined);
    setQuery("");
  }
  const commands: Command[] = [
    { id:"new-client", label:es.new.client, run:() => setEditor({ entity:"client" }) },
    ...(clients.length ? [{ id:"new-project", label:es.new.project, run:() => {
      navigate("projects");
      setEditor({ entity:"project" });
    } }] : []),
    ...clients.map((client) => ({
      id:"client-" + client.id, label:es.goToClient + " · " + client.name, run:() => {
        navigate("clients");
        setQuery(client.name);
      },
    })),
    ...projects.flatMap((project) => [
      { id:"project-" + project.id, label:es.goToProject + " · " + project.title, keywords:clientName(project.client_id), run:() => {
        navigate("projects");
        setSelected(project.id);
      } },
      { id:"new-link-" + project.id, label:es.newLinkIn + " " + project.title, keywords:clientName(project.client_id), run:() => {
        navigate("projects");
        setSelected(project.id);
        setEditor({ entity:"link" });
      } },
    ]),
    ...links.map((link) => ({
      id:"link-" + link.id, label:es.copyLink + " · " + link.title,
      keywords:[link.url, es.service[link.service], projects.find((project) => project.id === link.project_id)?.title].join(" "),
      run:() => void action(() => invoke("copy_link", { url:link.url }), es.copyDone),
    })),
  ];
  return <div className="shell">
    <aside><div className="brand"><img src={import.meta.env.BASE_URL + "capricorn-symbol.png"} alt=""/>{es.detailUi.appName}</div>
      <button className="command-trigger" onClick={() => setPalette(true)} aria-keyshortcuts="Control+K">
        {es.detailUi.search} <kbd>{es.detailUi.commandShortcut}</kbd>
      </button>
      <nav className="motion-nav" aria-label={es.detailUi.mainNav}
        style={{ "--active-row":sections.findIndex(([key]) => key === page) } as CSSProperties}>
        {sections.map(([key, label]) =>
          <button key={key} aria-current={page === key ? "page" : undefined} onClick={() => navigate(key)}>
            <NavIcon name={key}/><span>{label}</span>
            {key === "projects" && activeProjects.length > 0 && <Chip>{activeProjects.length}</Chip>}
            {key === "today" && overdueCount > 0 && <Chip tone="danger">{overdueCount}</Chip>}
          </button>)}
      </nav>
      <div className="theme">
        <p className="muted">{es.themeLabel} · {es.theme[theme]}</p>
        <div className="motion-choice theme-choice" role="group" aria-label={es.themeLabel}
          style={{ "--active-choice":themeChoices.findIndex(({ value }) => value === theme) } as CSSProperties}>
          {themeChoices.map(({ value, icon }) => <button key={value} type="button" aria-pressed={theme === value}
            aria-label={es.theme[value]} title={es.theme[value]}
            onClick={() => { if (theme !== value) void action(async () => setTheme(await invoke<Theme>("theme", { value }))); }}>
            <span aria-hidden="true">{icon}</span>
          </button>)}
        </div>
      </div>
    </aside>
    <main>
      <Toasts notice={notice} error={error} clearNotice={() => setNotice("")} clearError={() => setError("")}/>
      <div className="page-enter" key={page + ":" + (current?.id ?? "")}>
      {loading ? <Skeleton label={es.loading}/> : failed ? <button onClick={() => void load()}>{es.retry}</button> : page === "settings" ? <>
        <DesktopSettings/>
        <section className="overview-card palette-settings" aria-labelledby="palette-title">
          <h2 id="palette-title">{es.palettes.title}</h2>
          <div className="palette-grid" role="group" aria-labelledby="palette-title">
            {palettes.map((value) => <button type="button" key={value} className={"palette-tile palette-" + value}
              aria-pressed={appearance === value} onClick={() => {
                if (appearance !== value) void action(async () => setPaletteChoice(await invoke<Palette>("palette", { value })));
              }}>
              <span className="palette-swatches" aria-hidden="true"><i/><i/><i/><i/></span>
              <strong>{es.palettes[value].name}</strong>
              <span className="muted">{es.palettes[value].detail}</span>
            </button>)}
          </div>
        </section>
        <SocialApiSettings/>
        <DataSettings onChanged={async (next, restored) => {
          setDays(next);
          if (restored) {
            setClientFilter("");
            setSelected(undefined);
            await refresh();
          }
        }}/>
      </> : page === "invoices" ?
        <Invoices clients={clients} receipts={payments}/> : page === "payments" ?
        <Payments receipts={payments} clients={clients} projects={projects} refresh={refresh}/> : page === "today" ?
        <Today projects={projects} links={links} clients={clients} warningDays={days} open={(id) => { navigate("projects"); setSelected(id); }}/> :
        current && page === "projects" ?
        <ProjectControl key={current.id} id={current.id} refresh={refresh} status={current.status}
          onStatus={(status) => moveProject(current,status)} links={projectLinks.filter((link) => link.kind === "delivery")}>
          {({ openRevisions, linkedIds, workflow, feedback, dialog, registerLink, latest, nextVersion, activityCount, busy, addDelivery, addRevision }) =>
            <ProjectDetail title={current.title} projectType={current.type} clientName={clientName(current.client_id)} status={current.status} date={current.due_date}
              avatar={projectClient && <ClientAvatar person={projectClient} onEdit={() => setAvatarClientId(projectClient.id)}/>}
              latest={latest} pending={openRevisions} paidStatus={paidStatus} nextVersion={nextVersion} busy={busy}
              activityCount={activityCount} linkCount={projectLinks.length} activity={workflow} feedback={feedback} dialog={dialog}
              onBack={() => setSelected(undefined)} onStatus={(status) => moveProject(current,status)}
              addDelivery={addDelivery} addRevision={addRevision}
              actions={<>
                <button onClick={() => setEditor({ entity:"project", current })}>{es.detailUi.editProject}</button>
                {current.local_folder && <button onClick={() => void action(() => invoke("open_folder", { path:current.local_folder }))}>{es.detailUi.openFolder}</button>}
                <button onClick={() => archive("project", current.id)}>{es.detailUi.archiveProject}</button>
              </>}
              sidebar={<>
                {projectClient && <section className="overview-card">
                  <h2>{es.detailUi.customer}</h2>
                  <div className="project-client-heading"><ClientAvatar person={projectClient} onEdit={() => setAvatarClientId(projectClient.id)}/>
                    <div className="record-text"><strong>{projectClient.name}</strong>{projectClient.email && <div className="muted">{projectClient.email}</div>}</div></div>
                  <SocialChips profiles={profilesOf(current.client_id)} onOpen={openSocial}/>
                </section>}
                <ProjectPayment project={current} receipts={payments} clients={clients} projects={projects} refresh={refresh}/>
                <section className="overview-card">
                  <h2>{es.detailUi.details}</h2>
                  {current.local_folder && <button onClick={() => void action(() => invoke("open_folder", { path:current.local_folder }))}>{es.detailUi.openFolder}</button>}
                  {current.notes && <p className="notes">{current.notes}</p>}
                </section>
              </>}
              material={<>
            <div className="material-toolbar">
              <input type="search" value={linkQuery} placeholder={es.thumbnails.search} aria-label={es.thumbnails.search} onChange={(event) => setLinkQuery(event.target.value)}/>
              {projectLinks.length >= 4 && <details className="material-filters">
                <summary>{es.detailUi.filters}</summary>
                <div className="link-filters">
                  <select value={linkService} aria-label={es.thumbnails.filterService} onChange={(event) => setLinkService(event.target.value)}>
                    <option value="">{es.thumbnails.allServices}</option><Options values={es.service}/>
                  </select>
                  <select value={linkStatus} aria-label={es.thumbnails.filterStatus} onChange={(event) => setLinkStatus(event.target.value)}>
                    <option value="">{es.thumbnails.allStatuses}</option><Options values={es.download}/>
                  </select>
                  <select value={linkOrder} aria-label={es.thumbnails.sort} onChange={(event) => setLinkOrder(event.target.value as typeof linkOrder)}>
                    <Options values={es.thumbnails.orders}/>
                  </select>
                </div>
              </details>}
              <button onClick={() => setBatch(true)}>{es.thumbnails.batch}</button>
              <button className="primary" onClick={() => setEditor({ entity:"link" })}>{es.new.link}</button>
            </div>
            {!projectLinks.length && <p className="muted">{es.noLinks}</p>}
            {projectLinks.length > 0 && !visibleLinks.length && <p role="status">{es.noResults}</p>}
            {(Object.keys(es.kind) as Link["kind"][]).map((kind) => {
              const rows = visibleLinks.filter((link) => link.kind === kind);
              return rows.length > 0 && <SectionReveal key={kind}><h2 className="material-group-title">{es.kind[kind]} <Chip>{rows.length}</Chip></h2><div className="list">{rows.map((link) => {
                const now = new Date();
                const cutoff = new Date(now);
                cutoff.setDate(now.getDate() + days);
                const expired = link.expires_at && link.expires_at < calendarDate(now);
                const expiresSoon = !expired && link.kind === "material" && link.download_status === "pending" &&
                  link.expires_at && link.expires_at <= calendarDate(cutoff);
                const service = Object.hasOwn(es.service, link.service) ? link.service : "generic";
                return <article className="record link" key={link.id}>
                <span className={"service service--" + service} data-service={service} aria-hidden="true">
                  <img src={import.meta.env.BASE_URL + "services/" + service + ".png"} alt="" width={30} height={30}/>
                </span>
                <div className="record-text">
                  <strong className="truncate" title={link.title + " · " + link.url}>{link.title}</strong>
                  <div className="muted health-status">
                    {es.service[service]} · {es.download[link.download_status]}
                    {expired ? <Chip tone="danger">{es.control.health.expired}</Chip> : expiresSoon ? <Chip tone="warning">{es.control.expiresSoon}</Chip> : null}
                    {link.last_checked_at && <span title={es.control.checkHint}>{es.control.health[link.health]}</span>}
                  </div>
                </div>
                <div className="actions link-row-actions">
                  {kind === "delivery" && !linkedIds.has(link.id)
                    ? <button disabled={!registerLink} onClick={() => registerLink?.(link.id)}>{es.detailUi.registerLink}</button>
                    : <button onClick={() => void action(() => invoke("open_link", { url:link.url }))}>{es.open}</button>}
                  {link.download_status === "pending" && <button onClick={() => void action(async () => {
                    await invoke("save", { record:{ ...link, entity:"link", download_status:"downloaded" } });
                    await refresh();
                  }, es.saved)}>{es.detailUi.download}</button>}
                  <ActionMenu>
                    {kind === "delivery" && !linkedIds.has(link.id) && <button onClick={() => void action(() => invoke("open_link", { url:link.url }))}>{es.open}</button>}
                    <button onClick={() => void action(() => invoke("copy_link", { url:link.url }), es.copyDone)}>{es.copy}</button>
                  <button disabled={Boolean(checking)} onClick={() => {
                    setChecking(link.id);
                    void action(async () => {
                      const result = await invoke<{ health: keyof typeof es.control.health }>("check_link", { id:link.id });
                      await refresh();
                      setNotice(es.control.health[result.health] + ". " + es.control.checkHint);
                    }).finally(() => setChecking(undefined));
                  }}>{checking === link.id ? es.control.checking : es.control.check}</button>
                    {editActions("link", link)}
                  </ActionMenu>
                  <LinkThumbnail key={link.url} id={link.id} exists={Boolean(link.has_thumbnail)} drive={link.service === "drive"} title={link.title} onChange={refresh}>
                    <div className="url" title={link.url}>{link.url}</div>
                    {link.notes && <p className="notes">{link.notes}</p>}
                    {link.last_checked_at && <p className="muted">{es.control.checkHint}</p>}
                    <LinkPassword id={link.id} stored={Boolean(link.has_password)} onChange={refresh}/>
                  </LinkThumbnail>
                </div>
              </article>;
              })}</div></SectionReveal>;
            })}
              </>}/> }
        </ProjectControl> :
        <>
          <header><div className="client-title"><h1>{es.nav[page]}</h1>{page === "clients" && <ClientCount count={clients.length}/>}</div><button className="primary" onClick={() => setEditor({ entity:page === "clients" || !clients.length ? "client" : "project" })}>
            {page === "clients" || !clients.length ? es.new.client : es.new.project}
          </button></header>
          <input className="search" type="search" aria-label={es.search} placeholder={es.search} value={query} onChange={(event) => setQuery(event.target.value)}/>
          {page === "projects" && <div className="actions project-controls">
            <div className="motion-choice view-choice" role="group" aria-label="Vista de proyectos"
              style={{ "--active-choice":projectView === "list" ? 0 : 1 } as CSSProperties}>
              <button type="button" aria-pressed={projectView === "list"} onClick={() => setProjectView("list")}>{es.viewList}</button>
              <button type="button" aria-pressed={projectView === "board"} onClick={() => setProjectView("board")}>{es.viewBoard}</button>
            </div>
            <select aria-label={es.filterClient} value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
              <option value="">{es.allClients}</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>}
          {page === "clients" && missingAvatars.length > 0 && <div className="actions client-photo-actions">
            <button type="button" disabled={findingAvatars} onClick={() => void findClientAvatars()}>
              {findingAvatars ? "Buscando fotos…" : "Buscar fotos de clientes"}
            </button>
          </div>}
          {page === "clients" ?
            <div className="client-grid">{visibleClients.map((client) => <article className="overview-card client-card" key={client.id}><ClientAvatar person={client} onEdit={() => setAvatarClientId(client.id)}/><div className="record-text"><strong>{client.name}</strong><div className="muted">{es.detailUi.active(countsByClient.get(client.id) ?? 0)}</div><div className="muted">{[client.email, client.phone].filter(Boolean).join(" · ")}</div>{client.notes && <div className="notes">{client.notes}</div>}
              <SocialChips profiles={profilesOf(client.id)} onOpen={openSocial}/>
            </div><div className="actions">
              <button onClick={() => setSocialClientId(client.id)}>{es.social.manage}</button><ActionMenu>{editActions("client", client)}</ActionMenu>
            </div></article>)}
            {!clients.length ? <p className="muted">{es.noClients}</p> : !visibleClients.length && <p>{es.noResults}</p>}</div> :
            projects.length === 0 ? <div className="empty"><img src={import.meta.env.BASE_URL + "capricorn-symbol.png"} alt=""/><h2>{es.empty}</h2><p>{es.emptyHelp}</p></div> :
            projectView === "board" ?
            <div className="board">{(Object.entries(es.status) as [Project["status"], string][]).map(([status, label]) =>
              <section className="board-column" key={status} onDragOver={(event) => {
                if (event.dataTransfer.types.includes("application/x-capricorn-project")) event.preventDefault();
              }} onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("application/x-capricorn-project");
                const project = projects.find((item) => item.id === id);
                if (project) moveProject(project, status);
              }}>
                <h2>{label}</h2>
                <div className="list">{visible.filter((project) => project.status === status).map((project) =>
                  <article className="board-card" key={project.id} draggable onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-capricorn-project", project.id);
                  }}>
                    <button onClick={() => setSelected(project.id)}>{project.title}</button>
                    <div className="project-card-client">
                      {clientsById.has(project.client_id) && <ClientPortrait person={clientsById.get(project.client_id)!}/>}
                      <span className="muted">{clientName(project.client_id)}</span>
                    </div>
                    <ProjectTags status={project.status} date={project.due_date} payment={project.payment_status} showStatus={false}/>
                    <select aria-label={es.changeStatus + " · " + project.title} value={project.status}
                      onChange={(event) => moveProject(project, event.target.value as Project["status"])}>
                      <Options values={es.status}/>
                    </select>
                  </article>)}</div>
              </section>)}</div> :
            <div className="list project-list-enter">{visible.map((project) => {
              const client = clientsById.get(project.client_id);
              return <button className="record project project-list-card" key={project.id} onClick={() => setSelected(project.id)}>
                <span className="project-card-client">
                  {client && <ClientPortrait person={client}/>}
                  <span><strong className="truncate" title={project.title}>{project.title}</strong><span className="muted project-client-name truncate">{client?.name}</span></span>
                </span>
                <ProjectTags status={project.status} date={project.due_date} payment={project.payment_status}/>
              </button>;
            })}{!visible.length && <p>{es.noResults}</p>}</div>}
        </>}
      </div>
    </main>
    {avatarClient && <AvatarDialog person={avatarClient} profiles={profilesOf(avatarClient.id)}
      changed={refresh} close={() => setAvatarClientId(undefined)}/>}
    {socialClient && <SocialManager clientId={socialClient.id} clientName={socialClient.name} profiles={profilesOf(socialClient.id)}
      close={() => setSocialClientId(undefined)} changed={refresh}/>}
    {batch && current && <BatchLinks projectId={current.id} close={() => setBatch(false)} onSaved={async (count, skipped) => {
      setLinkQuery("");
      setLinkService("");
      setLinkStatus("");
      await refresh();
      setNotice(es.thumbnails.result(count, skipped));
    }}/>}
    {capture && <QuickCapture projects={projects} clients={clients} suggestedUrl={capture.url} close={() => setCapture(undefined)} onSave={save}/>}
    {palette && <CommandPalette commands={commands} close={() => setPalette(false)}/>}
    {editor && <RecordForm editor={editor} clients={clients} projectId={current?.id} close={() => setEditor(undefined)} onSave={save}/>}
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);