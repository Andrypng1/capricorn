import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "./desktop";

const connections = {
  twitch: { name:"Twitch", label:"Token de acceso", docs:"https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/" },
  kick: { name:"Kick", label:"Token de acceso", docs:"https://docs.kick.com/getting-started/generating-tokens" },
  youtube: { name:"YouTube", label:"Clave de YouTube Data API v3", docs:"https://developers.google.com/youtube/v3/getting-started" },
} as const;
type Provider = keyof typeof connections;

export function SocialApiSettings() {
  const [saved, setSaved] = useState<Partial<Record<Provider, boolean>>>({});
  const [busy, setBusy] = useState<Provider>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void invoke<typeof saved>("social_api_settings").then((value) => {
      if (active) setSaved(value);
    }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);

  async function update(provider: Provider, values: object, form?: HTMLFormElement) {
    if (busy) return;
    setBusy(provider);
    setError("");
    setStatus("");
    try {
      const present = await invoke<boolean>("social_api_settings", { provider, ...values });
      setSaved((old) => ({ ...old, [provider]:present }));
      setStatus(present ? "Credencial guardada." : "Credencial quitada.");
      form?.reset();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(undefined);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, provider: Provider) {
    event.preventDefault();
    const form = event.currentTarget;
    const contents = new FormData(form);
    void update(provider, { token:contents.get("token"), clientId:contents.get("clientId") }, form);
  }

  return <section className="overview-card integration-settings">
    <h2>Búsqueda de redes</h2>
    <p className="muted">Configura las plataformas que quieras consultar. Konect y el pegado de enlaces funcionan sin credenciales.</p>
    {(Object.keys(connections) as Provider[]).map((provider) => {
      const connection = connections[provider];
      return <details key={provider}>
        <summary>{connection.name}{saved[provider] ? " · Credencial guardada" : ""}</summary>
        <form onSubmit={(event) => submit(event, provider)}>
          {provider === "twitch" && <label>Client ID<input name="clientId" type="text" required autoComplete="off"/></label>}
          <label>{connection.label}<input name="token" type="password" required autoComplete="new-password"/></label>
          <div className="actions">
            <button type="button" onClick={() => void invoke("open_link", { url:connection.docs })
              .catch((reason) => setError(String(reason)))}>Cómo obtenerla</button>
            {saved[provider] && <button type="button" disabled={Boolean(busy)}
              onClick={() => void update(provider, { remove:true })}>Quitar credencial</button>}
            <button disabled={Boolean(busy)}>Guardar credencial</button>
          </div>
        </form>
      </details>;
    })}
    {status && <p role="status" className="notice">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}