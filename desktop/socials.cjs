const { randomUUID } = require("node:crypto");
const platforms = require("./social-platforms.json");

function prepareSocialUrl(value, webUrl) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("Pega un enlace al perfil.");
  const raw = value.trim();
  if (/\s/.test(raw)) throw new Error("Pega una sola URL, sin espacios.");
  const withScheme = /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(raw) ? raw : "https://" + raw;
  let url;
  try { url = webUrl(withScheme); }
  catch { throw new Error("Usa una dirección HTTP o HTTPS válida para el perfil."); }
  const host = url.hostname.replace(/\.$/, "");
  if (!host.includes(".")) throw new Error("Pega la dirección completa del perfil o sitio web.");
  const platform = Object.entries(platforms).find(([, domains]) => domains.some(
    (domain) => host === domain || host.endsWith("." + domain)
  ))?.[0] ?? "web";
  return { url:url.href, platform };
}

function socials(db, webUrl) {
  function saveSocial({ clientId, id, url, label }) {
    if (!db.prepare("SELECT 1 FROM clients WHERE id=? AND archived_at IS NULL").get(clientId))
      throw new Error("El cliente ya no está disponible.");
    const profile = prepareSocialUrl(url, webUrl);
    const name = typeof label === "string" ? label.trim() : "";
    if (name.length > 80) throw new Error("Usa una etiqueta de hasta 80 caracteres.");
    const same = db.prepare("SELECT id FROM client_socials WHERE client_id=? AND url=?").get(clientId, profile.url);
    if (same && same.id !== id) throw new Error("Este enlace ya está guardado para el cliente.");
    if (id) {
      const updated = db.prepare("UPDATE client_socials SET url=?,platform=?,label=? WHERE id=? AND client_id=?")
        .run(profile.url, profile.platform, name || null, id, clientId);
      if (!updated.changes) throw new Error("El perfil ya no está disponible.");
      return id;
    }
    const newId = randomUUID();
    db.prepare("INSERT INTO client_socials(id,client_id,platform,url,label,created_at) VALUES (?,?,?,?,?,?)")
      .run(newId, clientId, profile.platform, profile.url, name || null, new Date().toISOString());
    return newId;
  }

  function removeSocial({ clientId, id }) {
    const removed = db.prepare(
      "DELETE FROM client_socials WHERE id=? AND client_id=? AND client_id IN (SELECT id FROM clients WHERE archived_at IS NULL)"
    ).run(id, clientId);
    if (!removed.changes) throw new Error("El perfil ya no está disponible.");
  }

  function addSocials({ clientId, urls }) {
    if (!Array.isArray(urls) || urls.length > 41) throw new Error("Selecciona hasta 41 enlaces.");
    let count = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const raw of urls) {
        const profile = prepareSocialUrl(raw, webUrl);
        if (db.prepare("SELECT 1 FROM client_socials WHERE client_id=? AND url=?").get(clientId, profile.url)) continue;
        saveSocial({ clientId, url:profile.url });
        count++;
      }
      db.exec("COMMIT");
      return count;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return { saveSocial, removeSocial, addSocials };
}

module.exports = { socials, prepareSocialUrl };
