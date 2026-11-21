import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "./desktop";
import { es } from "./strings";

export function LinkThumbnail({ id, exists, drive, title, onChange, children }:  {
  id: string; exists: boolean; drive: boolean; title: string; onChange: () => Promise<void>; children?:ReactNode;
}) {
  const [source, setSource] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!exists) setSource(undefined);
    else void invoke<string | null>("link_thumbnail", { id, operation:"get" }).then((value) => {
      if (active) setSource(value ?? undefined);
    }).catch((error) => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, [exists, id]);

  async function update(operation: "drive" | "local" | "remove") {
    setBusy(true);
    setMessage("");
    try {
      const value = await invoke<string | null | undefined>("link_thumbnail", { id, operation });
      if (value === undefined) return;
      setSource(value ?? undefined);
      await onChange();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="link-thumb">
    {source && <img src={source} alt={es.thumbnails.alt + " " + title} loading="lazy"/>}
    <details>
      <summary>{children ? es.detailUi.compactDetails : es.thumbnails.label}</summary>
      <div className="actions">
        {drive && <button disabled={busy} onClick={() => void update("drive")}>{es.thumbnails.drive}</button>}
        <button disabled={busy} onClick={() => void update("local")}>{es.thumbnails.local}</button>
        {source && <button disabled={busy} onClick={() => void update("remove")}>{es.thumbnails.remove}</button>}
      </div>
      {children}
    </details>
    {busy && <p role="status" className="muted">{es.loading}</p>}
    {message && <p role="alert" className="muted">{message}</p>}
  </div>;
}

export function BatchLinks({ projectId, onSaved, close }: {
  projectId: string; onSaved: (count: number, skipped: number) => Promise<void>; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const result = await invoke<{ count: number; skipped: number }>("add_links", {
        projectId, text:values.get("urls"), kind:values.get("kind"), expires:values.get("expires"),
      });
      await onSaved(result.count, result.skipped);
      close();
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }
  return <dialog ref={dialog} aria-labelledby="batch-title" onCancel={(event) => {
    event.preventDefault();
    if (!saving) close();
  }}>
    <form onSubmit={save}>
      <h2 id="batch-title">{es.thumbnails.batch}</h2>
      <label>{es.thumbnails.urls}<textarea name="urls" autoFocus required maxLength={160000} rows={6}/></label>
      <label>{es.label.kind}<select name="kind">{Object.entries(es.kind).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>{es.label.expires_at}<input type="date" name="expires"/></label>
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button type="button" onClick={close} disabled={saving}>{es.cancel}</button>
        <button className="primary" disabled={saving}>{es.save}</button></div>
    </form>
  </dialog>;
}
