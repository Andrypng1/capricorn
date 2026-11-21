import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "./desktop";
import { es } from "./strings";
import type { ClientSocial } from "./client-socials";

type Person = { id: string; name: string; color?: string | null; avatar_updated?: string | null };

function useAvatar(person: Person) {
  const [image, setImage] = useState<{ revision:string; url:string }>();
  const revision = person.avatar_updated;
  useEffect(() => {
    let active = true;
    if (revision) void invoke<string | null>("client_avatar", { id:person.id, operation:"get" }).then((url) => {
      if (active && url) setImage({ revision, url });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [person.id, revision]);
  return image && image.revision === revision ? image.url : undefined;
}

function Portrait({ person, image }: { person: Person; image?: string }) {
  const initials = person.name.trim().split(/\s+/).slice(0,2).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase();
  return <span className="client-avatar" style={{ "--avatar-color":person.color || "var(--accent)" } as React.CSSProperties} aria-hidden="true">
    {image ? <img src={image} alt="" width={50} height={50}/> : <span>{initials || "?"}</span>}
  </span>;
}

export function ClientPortrait({ person }: { person:Person }) {
  const image = useAvatar(person);
  return <Portrait person={person} image={image}/>;
}

export function ClientAvatar({ person, onEdit }: { person: Person; onEdit: () => void }) {
  const image = useAvatar(person);
  const label = (image ? es.detailUi.avatarChange : es.detailUi.avatarAdd)(person.name);
  return <button type="button" className="client-avatar-button" aria-label={label} title={label} onClick={onEdit}>
    <Portrait person={person} image={image}/>
  </button>;
}

export function AvatarDialog({ person, profiles, changed, close }: {
  person: Person; profiles: ClientSocial[]; changed: () => Promise<void>; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useAvatar(person);
  const automatic = profiles.filter(({platform}) => ["konect","twitch","youtube","kick","instagram","tiktok","x","threads","behance","facebook"].includes(platform));
  const [socialId, setSocialId] = useState(automatic[0]?.id ?? profiles[0]?.id ?? "");
  const selected = profiles.find((profile) => profile.id === socialId);
  const canImport = automatic.some((profile) => profile.id === socialId);

  async function openProfile() {
    if (!selected) return;
    try { await invoke("open_link", { url:selected.url }); }
    catch { setError("No se pudo abrir el perfil en el navegador."); }
  }
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function update(operation: "social" | "local" | "paste" | "url" | "remove") {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await invoke<string | null | undefined>("client_avatar", { id:person.id, operation, socialId, url:imageUrl });
      if (result !== undefined) {
        await changed();
        setNotice(operation === "remove" ? "Foto quitada." : "Foto guardada.");
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ""));
    }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>, operation: "social" | "url") {
    event.preventDefault();
    void update(operation);
  }

  return <dialog ref={dialog} className="avatar-dialog" aria-labelledby="avatar-title" onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <div className="workflow-heading">
      <div><h2 id="avatar-title">Foto de perfil</h2><p className="muted">{person.name}</p></div>
      <button type="button" disabled={busy} onClick={close}>Cerrar</button>
    </div>
    <div className="avatar-preview"><Portrait person={person} image={image}/></div>
    {profiles.length > 0 && <form className="avatar-form" onSubmit={(event) => submit(event, "social")}>
      <label>Perfil guardado<select title={selected?.url} value={socialId} onChange={(event) => setSocialId(event.target.value)}>
        {profiles.map((profile) => <option key={profile.id} value={profile.id} title={profile.url}>
          {es.social.platforms[profile.platform]}{profile.label ? " · " + profile.label : " · " + (new URL(profile.url).pathname.split("/").filter(Boolean).at(-1) ?? new URL(profile.url).hostname)}
        </option>)}
      </select></label>
      <div className="actions">
        <button type="button" disabled={busy || !selected} onClick={() => void openProfile()}>Abrir perfil</button>
        {canImport && <button disabled={busy}>Obtener foto del perfil</button>}
      </div>
    </form>}
    <div className="actions avatar-actions">
      <button type="button" disabled={busy} onClick={() => void update("local")}>Elegir archivo</button>
      <button type="button" disabled={busy} onClick={() => void update("paste")}>Pegar foto</button>
      {person.avatar_updated && <button type="button" disabled={busy} onClick={() => void update("remove")}>Quitar foto</button>}
    </div>
    <details>
      <summary>Usar una dirección de imagen</summary>
      <form className="avatar-form" onSubmit={(event) => submit(event, "url")}>
        <label>URL directa de la foto<input type="url" required value={imageUrl} onChange={(event) => setImageUrl(event.target.value)}/></label>
        <p className="muted">En el navegador, haz clic derecho en la foto de Instagram u otra red compatible y copia la dirección de la imagen.</p>
        <button disabled={busy}>Guardar imagen</button>
      </form>
    </details>
    {busy && <p role="status">Guardando foto…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="avatar-error">{error}</p>}
  </dialog>;
}