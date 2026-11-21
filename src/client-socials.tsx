import { useEffect, useRef, useState, type FormEvent } from "react";
import platforms from "../desktop/social-platforms.json";
import { invoke } from "./desktop";
import { es } from "./strings";

const labels = es.social;
const discoveryPlatforms = new Set(["twitch","kick","youtube","konect"]);
type Platform = keyof typeof platforms | "web";
export type ClientSocial = { id: string; client_id: string; platform: Platform; url: string; label: string | null };

function identify(url: string): Platform | null {
  try {
    if (!url.trim()) return null;
    const value = url.trim();
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : "https://" + value);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) return null;
    const host = parsed.hostname.replace(/\.$/, "");
    const detected = Object.entries(platforms).find(([, aliases]) =>
      aliases.some((name) => host === name || host.endsWith("." + name)));
    return detected ? detected[0] as Platform : "web";
  } catch {
    return null;
  }
}

function platformFor(profile: ClientSocial) {
  return Object.hasOwn(labels.platforms, profile.platform) ? profile.platform : "web";
}

function displayName(profile: ClientSocial) {
  const name = labels.platforms[platformFor(profile)];
  return profile.label ? name + " · " + profile.label : name;
}

function SocialIcon({ platform }: { platform: Platform }) {
  return <span className={"social-icon social-" + platform} aria-hidden="true">
    <img src={import.meta.env.BASE_URL + "socials/" + platform + ".png"} alt="" width={22} height={22}/>
  </span>;
}

export function SocialChips({ profiles, onOpen }: { profiles: ClientSocial[]; onOpen: (url: string) => void }) {
  if (!profiles.length) return null;
  return <div className="social-chips" role="group" aria-label={labels.heading}>
    {profiles.map((profile) => <button type="button" className="social-chip" key={profile.id} data-platform={platformFor(profile)}
      title={profile.url} onClick={() => onOpen(profile.url)}>
      <SocialIcon platform={platformFor(profile)}/>
      <span>{displayName(profile)}</span>
    </button>)}
  </div>;
}

type Mode = { type:"add" } | { type:"edit" | "remove"; profile:ClientSocial };

export function SocialManager({ clientId, clientName, profiles, close, changed }: {
  clientId: string; clientName: string; profiles: ClientSocial[];
  close: () => void; changed: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const discoveryPanel = useRef<HTMLDivElement>(null);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<Mode>({ type:"add" });
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const platform = identify(url);
  const [found, setFound] = useState<(Pick<ClientSocial, "url" | "platform"> & { origin?: string; guessed?: boolean; health?: "ok" | "broken" | "unknown" })[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [profilePage, setProfilePage] = useState("");
  const [discoveryNote, setDiscoveryNote] = useState("");

  async function search(source?: string) {
    if (busy) return;
    setBusy(true);
    setSearching(true);
    setProfilePage("");
    discoveryPanel.current?.scrollIntoView({ block:"nearest" });
    setError("");
    setDiscoveryNote("");
    setFound([]);
    setPicked(new Set());
    try {
      const result = source === undefined
        ? { profiles:await invoke<typeof found>("parse_social", { text:pasted }), status:"ok" as const, page:"" }
        : await invoke<{ profiles:typeof found; status:"ok" | "credentials" | "authorization" | "handle" | "unavailable" | "partial" | "guesses"; page:string }>("discover_social", { url:source });
      setProfilePage(result.page);
      const existing = new Set(profiles.map((profile) => profile.url));
      const available = result.profiles.filter((profile) => !existing.has(profile.url));
      setFound(available);
      setPicked(new Set(available.filter((profile) => !profile.guessed && profile.health !== "broken").map((profile) => profile.url)));
      if (result.status !== "ok") setDiscoveryNote(labels[result.status]);
      else if (!available.length) setDiscoveryNote(labels.noFound);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSearching(false);
      setBusy(false);
    }
  }

  function tryAvatar() {
    void invoke<boolean>("auto_client_avatar", { id:clientId }).then(async (added) => {
      if (added) {
        await changed();
        setNotice("Perfil guardado y foto actualizada.");
      }
    }).catch(() => undefined);
  }

  async function importProfiles(urls: string[]) {
    setBusy(true);
    setError("");
    try {
      const count = await invoke<number>("add_socials", { clientId, urls });
      await changed();
      setFound([]);
      setPicked(new Set());
      setDiscoveryNote(labels.added(count));
      if (count) tryAvatar();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const element = ref.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    if (mode.type === "remove") cancel.current?.focus();
    if (mode.type === "edit") urlInput.current?.focus();
  }, [mode]);

  function reset() {
    setMode({ type:"add" });
    setUrl("");
    setLabel("");
  }

  function select(type: "edit" | "remove", profile: ClientSocial) {
    setMode({ type, profile });
    setUrl(profile.url);
    setLabel(profile.label ?? "");
    setError("");
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode.type === "remove") {
        await invoke("remove_social", { clientId, id:mode.profile.id });
        setNotice(labels.removed);
      } else {
        await invoke("save_social", { clientId, id:mode.type === "edit" ? mode.profile.id : undefined, url, label });
        setNotice(es.saved);
      }
      reset();
      await changed();
      if (mode.type !== "remove") tryAvatar();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={ref} className="social-dialog" aria-labelledby="social-dialog-title" onCancel={(event) => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <div className="workflow-heading">
      <div><h2 id="social-dialog-title">{labels.heading}</h2><p className="muted">{clientName}</p></div>
      <button type="button" disabled={busy} onClick={close}>{labels.close}</button>
    </div>
    {profiles.length > 0 && <ul className="social-list">
      {profiles.map((profile) => <li key={profile.id}>
        <SocialIcon platform={platformFor(profile)}/>
        <div className="social-list-copy">
          <strong>{displayName(profile)}</strong><p className="url" title={profile.url}>{profile.url}</p>
        </div>
        <div className="actions">
          {mode.type === "add" && discoveryPlatforms.has(platformFor(profile)) && <button type="button"
            aria-label={labels.discover + " · " + displayName(profile)} disabled={busy}
            onClick={() => void search(profile.url)}>{labels.discoverSaved}</button>}
          <button type="button" onClick={() => select("edit", profile)} disabled={busy}>{es.editAction}</button>
          <button type="button" onClick={() => select("remove", profile)} disabled={busy}>{labels.remove}</button>
        </div>
      </li>)}
    </ul>}
    <form className="social-form" onSubmit={save}>
      {mode.type === "remove"
        ? <p>{labels.removePrompt(displayName(mode.profile))}</p>
        : <>
          <label>{labels.url}<input ref={urlInput} autoFocus name="profile" type="text" inputMode="url" autoComplete="url"
            maxLength={4096} required value={url} onChange={(event) => setUrl(event.target.value)} placeholder={labels.example}/></label>
          {platform && <p className="social-detected muted" role="status"><SocialIcon platform={platform}/>{labels.platforms[platform]}</p>}
          <label>{labels.label}<input name="label" type="text" maxLength={80} placeholder={labels.labelExample}
            value={label} onChange={(event) => setLabel(event.target.value)}/></label>
        </>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      <div className="actions">
        {mode.type !== "add" && <button ref={cancel} type="button" disabled={busy} onClick={() => { reset(); setError(""); }}>{es.cancel}</button>}
        <button className={mode.type === "remove" ? "danger-button" : "primary"} disabled={busy}>
          {mode.type === "remove" ? labels.remove : mode.type === "edit" ? es.save : labels.add}
        </button>
      </div>
    </form>
    {mode.type === "add" && <div className="social-discovery" ref={discoveryPanel} aria-busy={searching}>
      <p className="muted">{labels.discoveryHelp}</p>
      <button type="button" disabled={busy || !platform || !discoveryPlatforms.has(platform)}
        onClick={() => void search(url)}>{labels.discover}</button>
      <details>
        <summary>{labels.paste}</summary>
        <label>{labels.pasteLabel}<textarea rows={3} maxLength={30000} value={pasted} onChange={(event) => setPasted(event.target.value)}/></label>
        <button type="button" disabled={busy || !pasted.trim()} onClick={() => void search()}>{labels.detect}</button>
      </details>
      {searching && <p role="status" className="muted">{labels.searching}</p>}
      {profilePage && <button type="button" onClick={() => void invoke("open_link", { url:profilePage })
        .catch((reason) => setError(String(reason)))}>{labels.openProfile}</button>}
      {discoveryNote && <p role="status" className="muted">{discoveryNote}</p>}
      {found.length > 0 && <fieldset className="discovery-results">
        <legend>{labels.suggestions}</legend>
        {found.map((profile) => <label className="discovery-profile" key={profile.url}>
          <input type="checkbox" checked={picked.has(profile.url)} disabled={busy} onChange={(event) => {
            const checked = event.target.checked;
            setPicked((old) => {
              const next = new Set(old);
              if (checked) next.add(profile.url); else next.delete(profile.url);
              return next;
            });
          }}/>
          <SocialIcon platform={profile.platform}/><span>{profile.url}<br/><small className="muted">{profile.origin ?? labels.pickedOrigin}{profile.health && " · " + labels.health[profile.health]}</small></span>
        </label>)}
        <button type="button" className="primary" disabled={busy || !picked.size}
          onClick={() => void importProfiles([...picked])}>{picked.size === found.length ? labels.addAll : labels.addSelected}</button>
      </fieldset>}
    </div>}
  </dialog>;
}
