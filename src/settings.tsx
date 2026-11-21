import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "./desktop";
import { es } from "./strings";

type Settings = { shortcut: string; hideToTray: boolean; startWithWindows: boolean; monitorClipboard: boolean };

function SettingSwitch({ checked, change, label }: { checked:boolean; change:(value:boolean) => void; label:string }) {
  return <label className="setting-switch">
    <input type="checkbox" role="switch" checked={checked} onChange={(event) => change(event.target.checked)}/>
    <span className="switch-track" aria-hidden="true"/>
    <span>{label}</span>
  </label>;
}

export function DesktopSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void invoke<Settings>("desktop_settings").then((value) => {
      if (active) setSettings(value);
    }).catch((reason) => {
      if (active) setError(String(reason));
    });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !settings) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      setSettings(await invoke<Settings>("desktop_settings", { settings }));
      setNotice(es.saved);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <header><h1>{es.nav.settings}</h1></header>
    {error && <p className="alert" role="alert">{error}</p>}
    {settings ? <form className="overview-card" style={{ maxWidth: 500 }} onSubmit={save}>
      <label>{es.desktopShortcut}<input required value={settings.shortcut}
        onChange={(event) => setSettings({ ...settings, shortcut:event.target.value })}/>
        <span className="muted">{es.shortcutHelp}</span>
      </label>
      <SettingSwitch checked={settings.hideToTray} label={es.hideToTray}
        change={(value) => setSettings({ ...settings, hideToTray:value })}/>
      <SettingSwitch checked={settings.startWithWindows} label={es.startWithWindows}
        change={(value) => setSettings({ ...settings, startWithWindows:value })}/>
      <SettingSwitch checked={settings.monitorClipboard} label={es.monitorClipboard}
        change={(value) => setSettings({ ...settings, monitorClipboard:value })}/>
      <div className="actions"><button className="primary" disabled={busy}>{es.save}</button></div>
      <div role="status" className="notice">{notice}</div>
    </form> : !error && <p>{es.loading}</p>}
  </>;
}
