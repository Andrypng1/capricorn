import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "./desktop";
import { es } from "./strings";

export type DataPreferences = { days: number; copies: number; folder: string };

export function DataSettings({ onChanged }: { onChanged: (days: number, restored?: boolean) => Promise<void> }) {
  const [settings, setSettings] = useState<DataPreferences>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const labels = es.data;

  useEffect(() => {
    let active = true;
    void invoke<DataPreferences>("data_settings").then((value) => {
      if (active) setSettings(value);
    }).catch((reason) => {
      if (active) { setError(true); setMessage(String(reason)); }
    });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<boolean | void>, note: string) {
    if (busy) return;
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      if (await action() !== false) setMessage(note);
    } catch (reason) {
      setError(true);
      setMessage(String(reason));
    } finally {
      setBusy(false);
    }
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    void run(async () => {
      const saved = await invoke<DataPreferences>("data_settings", { settings });
      setSettings(saved);
      await onChanged(saved.days);
    }, es.saved);
  }

  function folder(clear = false) {
    void run(async () => setSettings(await invoke<DataPreferences>("backup_folder", { clear })), es.saved);
  }

  function dataFile(operation: "export" | "import" | "links" | "deliveries") {
    void run(async () => {
      const done = await invoke<boolean>("data_file", { operation });
      if (done && operation === "import") await onChanged(settings?.days ?? 2, true);
      return done;
    }, operation === "import" ? labels.restored : labels.exported);
  }

  return <section className="overview-card data-settings">
    <h2>{labels.heading}</h2>
    {settings && <>
      <form onSubmit={apply}>
        <div className="control-fields">
          <label>{labels.days}<input type="number" required min="0" max="30" value={settings.days}
            onChange={(event) => setSettings({ ...settings, days:event.target.valueAsNumber })}/></label>
          <label>{labels.copies}<input type="number" required min="1" max="30" value={settings.copies}
            onChange={(event) => setSettings({ ...settings, copies:event.target.valueAsNumber })}/></label>
        </div>
        <div className="actions"><button disabled={busy}>{es.save}</button></div>
      </form>
      <div className="backup-actions">
        <p className="muted">{settings.folder || labels.noFolder}</p>
        <div className="actions">
          <button disabled={busy} onClick={() => folder()}>{labels.choose}</button>
          {settings.folder && <button disabled={busy} onClick={() => folder(true)}>{labels.disable}</button>}
          <button disabled={busy || !settings.folder} onClick={() => void run(async () => { await invoke("backup_now"); }, labels.exported)}>{labels.backup}</button>
        </div>
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => dataFile("export")}>{labels.export}</button>
        <button disabled={busy} onClick={() => dataFile("import")}>{labels.import}</button>
        <button disabled={busy} onClick={() => dataFile("links")}>{labels.csvLinks}</button>
        <button disabled={busy} onClick={() => dataFile("deliveries")}>{labels.csvDeliveries}</button>
      </div>
      <p className="muted">{labels.help}</p>
    </>}
    {message && <p role={error ? "alert" : "status"}>{message}</p>}
  </section>;
}
