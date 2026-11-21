const { DatabaseSync } = require("node:sqlite");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { join } = require("node:path");
const { listing, upsert } = require("./queries.json");
const rules = require("./services.json");
const { payments } = require("./payments.cjs");
const { control } = require("./control.cjs");
const { socials } = require("./socials.cjs");
const { archives } = require("./data.cjs");

const tables = new Map([["client", "clients"], ["project", "projects"], ["link", "links"]]);
const projectStatuses = ["received","editing","review","changes_requested","approved","delivered","archived"];

function webUrl(value) {
  if (typeof value !== "string") throw new Error("Introduce una URL válida.");
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Usa una URL HTTP o HTTPS sin credenciales incrustadas.");
  }
  return url;
}

function serviceFor(url) {
  const host = url.hostname.replace(/\.$/, "");
  return Object.keys(rules).find((service) => rules[service].some(
    (domain) => host === domain || host.endsWith("." + domain)
  )) ?? "generic";
}

function required(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Completa el nombre o título.");
  return value.trim();
}

function connect(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  try {
    db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
    const { user_version: version } = db.prepare("PRAGMA user_version").get();
    if (version > 7) throw new Error("Esta versión de Capricorn no puede abrir la base de datos.");
    if (version === 0) db.exec(readFileSync(join(__dirname, "001.sql"), "utf8"));
    if (version < 2) db.exec(readFileSync(join(__dirname, "002.sql"), "utf8"));
    if (version < 3) db.exec(readFileSync(join(__dirname, "003.sql"), "utf8"));
    if (version < 4) db.exec(readFileSync(join(__dirname, "004.sql"), "utf8"));
    if (version < 5) db.exec(readFileSync(join(__dirname, "005.sql"), "utf8"));
    if (version < 6) db.exec(readFileSync(join(__dirname, "006.sql"), "utf8"));
    if (version < 7) db.exec(readFileSync(join(__dirname, "007.sql"), "utf8"));
    db.exec("COMMIT;");
  } catch (error) {
    db.close();
    throw error;
  }

  function snapshot() {
    return Object.fromEntries(Object.entries(listing).map(([name, sql]) => [
      name, db.prepare(sql).all().map((row) => JSON.parse(Object.values(row)[0])),
    ]));
  }

  function save(record) {
    if (!record || !tables.has(record.entity)) throw new Error("Tipo de registro inválido.");
    const { entity } = record;
    const id = record.id ?? randomUUID();
    const optional = (name) => typeof record[name] === "string" ? record[name].trim() || null : null;
    let values;
    switch (entity) {
      case "client":
        values = [required(record.name), optional("email"), optional("phone"), optional("notes"), optional("color")];
        break;
      case "project":
        values = [required(record.client_id), required(record.title), optional("type") ?? "", record.status, optional("due_date"), optional("local_folder"), optional("notes")];
        break;
      case "link": {
        const url = webUrl(record.url);
        values = [required(record.project_id), record.kind, required(record.title), url.href, serviceFor(url), optional("expires_at"), record.download_status, optional("notes")];
        break;
      }
    }
    const bindings = Object.fromEntries([id, ...values].map((value, index) => ["p" + (index + 1), value]));
    if (!db.prepare(upsert[entity]).run(bindings).changes) throw new Error("El registro ya no está disponible.");
    return id;
  }

  function addLinks({ projectId, text, kind, expires }) {
    if (typeof text !== "string" || text.length > 160000) throw new Error("La lista de enlaces es demasiado larga.");
    const lines = text.split(/\r?\n/).map((line, index) => ({ line:line.trim(), index })).filter(({ line }) => line);
    if (lines.length === 0 || lines.length > 100) throw new Error("Pega entre 1 y 100 enlaces, uno por línea.");
    if (!["material","delivery","revision","reference"].includes(kind)) throw new Error("Tipo de enlace inválido.");
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new Error("Fecha de caducidad inválida.");
    const urls = lines.map(({ line, index }) => {
      try { return webUrl(line); }
      catch { throw new Error("Revisa la URL de la línea " + (index + 1) + "."); }
    });
    let count = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = new Set(db.prepare("SELECT url FROM links WHERE project_id=? AND kind=? AND archived_at IS NULL")
        .all(projectId, kind).map((row) => row.url));
      for (const url of urls) {
        if (existing.has(url.href)) continue;
        const service = serviceFor(url);
        const file = url.pathname.split("/").filter(Boolean).at(-1);
        const prefix = service === "generic" ? url.hostname : ({ drive:"Drive",dropbox:"Dropbox",wetransfer:"WeTransfer",mega:"MEGA",frame:"Frame.io",cloudflare:"Cloudflare" })[service] ?? url.hostname;
        const title = file && /\.[A-Za-z0-9]{2,6}$/.test(file) ? file : prefix + " · Enlace " + (existing.size + 1);
        save({ entity:"link", project_id:projectId, kind, url:url.href, title, expires_at:expires, download_status:"pending" });
        existing.add(url.href);
        count++;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { count, skipped:urls.length - count };
  }

  function requireClient(id) {
    if (!db.prepare("SELECT 1 FROM clients WHERE id=? AND archived_at IS NULL").get(id))
      throw new Error("El cliente ya no está disponible.");
  }

  function getAvatar(id) {
    requireClient(id);
    return db.prepare("SELECT jpeg FROM client_avatars WHERE client_id=?").get(id)?.jpeg ?? null;
  }

  function setAvatar(id, jpeg) {
    requireClient(id);
    if (jpeg === null) db.prepare("DELETE FROM client_avatars WHERE client_id=?").run(id);
    else db.prepare("INSERT INTO client_avatars VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET jpeg=excluded.jpeg,updated_at=excluded.updated_at")
      .run(id, jpeg, new Date().toISOString());
  }

  function avatarProfiles(id) {
    requireClient(id);
    return db.prepare("SELECT platform,url FROM client_socials WHERE client_id=? ORDER BY CASE platform WHEN 'konect' THEN 0 WHEN 'twitch' THEN 1 WHEN 'youtube' THEN 2 ELSE 3 END, created_at").all(id);
  }

  function avatarProfile(id, socialId) {
    requireClient(id);
    const profile = db.prepare("SELECT url,platform FROM client_socials WHERE id=? AND client_id=?").get(socialId,id);
    if (!profile) throw new Error("Ese perfil ya no está disponible.");
    return profile;
  }

  function getThumbnail(id) {
    return db.prepare("SELECT jpeg FROM link_thumbnails WHERE link_id=?").get(id)?.jpeg ?? null;
  }

  function setThumbnail(id, jpeg) {
    if (jpeg === null) db.prepare("DELETE FROM link_thumbnails WHERE link_id=?").run(id);
    else db.prepare("INSERT INTO link_thumbnails VALUES (?,?) ON CONFLICT(link_id) DO UPDATE SET jpeg=excluded.jpeg").run(id, jpeg);
  }

  function changeProjectStatus(id, status) {
    if (!projectStatuses.includes(status)) throw new Error("Estado inválido.");
    const result = db.prepare(
      "UPDATE projects SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND archived_at IS NULL AND client_id IN (SELECT id FROM clients WHERE archived_at IS NULL)"
    ).run(status, id);
    if (!result.changes) throw new Error("El proyecto ya no está disponible.");
  }

  function archive(entity, id) {
    const table = tables.get(entity);
    if (!table) throw new Error("Tipo de registro inválido.");
    db.prepare("UPDATE " + table + " SET archived_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
  }

  function theme(value) {
    if (value === undefined) return db.prepare("SELECT value FROM settings WHERE key='theme'").get()?.value ?? "dark";
    if (!["dark", "light", "system"].includes(value)) throw new Error("Tema inválido.");
    db.prepare("INSERT INTO settings VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
    return value;
  }

  function palette(value) {
    if (value === undefined) {
      const stored = db.prepare("SELECT value FROM settings WHERE key='palette'").get()?.value;
      return ["minimal","cyberpunk","modern"].includes(stored) ? stored : "minimal";
    }
    if (!["minimal","cyberpunk","modern"].includes(value)) throw new Error("Paleta inválida.");
    db.prepare("INSERT INTO settings VALUES ('palette', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
    return value;
  }

  function desktopSettings() {
    const row = db.prepare("SELECT value FROM settings WHERE key='desktop'").get();
    if (row) return { monitorClipboard:false, ...JSON.parse(row.value) };
    return { shortcut:"Control+Shift+C", hideToTray:true, startWithWindows:false, monitorClipboard:false };
  }

  function setDesktopSettings(settings) {
    db.prepare("INSERT INTO settings VALUES ('desktop', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
    return settings;
  }

  const workflow = control(db);

  function saveDelivery(args, edit = false) {
    const operation = edit ? workflow.editDelivery : workflow.createDelivery;
    if (typeof args.linkUrl !== "string" || !args.linkUrl.trim()) return operation(args);
    const projectId = edit ? args.projectId : args.id;
    const url = webUrl(args.linkUrl);
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT id FROM links WHERE project_id=? AND kind='delivery' AND archived_at IS NULL AND url=? ORDER BY rowid LIMIT 1")
        .get(projectId, url.href);
      const linkId = existing?.id ?? save({
        entity:"link", project_id:projectId, kind:"delivery",
        title:"Entrega · " + url.hostname, url:url.href, download_status:"downloaded",
      });
      const result = operation({ ...args, linkId });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return { ...workflow, createDelivery: (args) => saveDelivery(args), editDelivery: (args) => saveDelivery(args, true), ...payments(db), ...archives(db, webUrl), ...socials(db, webUrl), desktopSettings, setDesktopSettings, snapshot, save, getAvatar, setAvatar, avatarProfile, avatarProfiles, addLinks, getThumbnail, setThumbnail, changeProjectStatus, archive, theme, palette, close: () => db.close() };
}

module.exports = { connect, webUrl, serviceFor };
