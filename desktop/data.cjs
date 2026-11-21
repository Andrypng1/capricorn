const { readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { prepareSocialUrl } = require("./socials.cjs");
const { zipSync, unzipSync, strFromU8, strToU8 } = require("fflate");

const tables = ["clients","projects","links","deliveries","revisions","link_thumbnails","client_socials","client_avatars","payments"];
const schema = 7;
const maxSize = 64 * 1024 * 1024;
const archiveName = "capricorn.json";

function csv(rows, headings) {
  function cell(input) {
    let value = String(input ?? "");
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(value)) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
  }
  return "\ufeff" + [headings, ...rows.map((row) => headings.map((heading) => row[heading]))]
    .map((row) => row.map(cell).join(",")).join("\r\n");
}

function archives(db, webUrl) {
  function collection() {
    const records = Object.fromEntries(tables.map((table) => [table, db.prepare("SELECT * FROM " + table).all()]));
    for (const link of records.links) {
      link.has_password = Boolean(link.password_ref);
      delete link.password_ref;
    }
    return { format:"capricorn", schema, records };
  }

  function writeArchive(path) {
    const encoded = strToU8(JSON.stringify(collection()));
    if (encoded.length > maxSize) throw new Error("La copia supera el límite de tamaño.");
    writeFileSync(path, zipSync({ [archiveName]:encoded }));
  }

  function restoreArchive(path) {
    if (statSync(path).size > maxSize) throw new Error("La copia supera el límite de tamaño.");
    const zipped = unzipSync(readFileSync(path), { filter: ({ name, originalSize }) => name === archiveName && originalSize <= maxSize });
    if (!zipped[archiveName]) throw new Error("La copia no contiene datos válidos.");
    const data = JSON.parse(strFromU8(zipped[archiveName]));
    if (data?.format === "capricorn" && data.schema === 2 && data.records) data.records.link_thumbnails = [];
    if (data?.format === "capricorn" && [2,3,4].includes(data.schema) && data.records) data.records.client_socials = [];
    if (data?.format === "capricorn" && [2,3,4,5].includes(data.schema) && data.records) data.records.client_avatars = [];
    if (data?.format === "capricorn" && [2,3,4,5,6].includes(data.schema) && data.records) data.records.payments = [];
    if (data?.format !== "capricorn" || ![2, 3, 4, 5, 6, schema].includes(data.schema) ||
        !tables.every((table) => Array.isArray(data.records?.[table])))
      throw new Error("Formato o versión de respaldo incompatible.");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [...tables].reverse()) db.exec("DELETE FROM " + table);
      for (const table of tables) {
        const columns = db.prepare("PRAGMA table_info(" + table + ")").all()
          .map((column) => column.name);
        const insert = db.prepare("INSERT INTO " + table + "(" + columns.join(",") + ") VALUES (" + columns.map(() => "?").join(",") + ")");
        for (const item of data.records[table]) {
          const row = table === "client_socials" ? { ...item, ...prepareSocialUrl(item.url, webUrl) } : item;
          insert.run(...columns.map((column) => {
            const value = column === "password_ref"
              ? (row.has_password === true && /^[a-f0-9-]{36}$/i.test(row.id) ? row.id : null)
              : column === "currency" && table === "projects"
                ? "USD"
                : row[column] ?? null;
            if (column === "jpeg" && (typeof value !== "string" || value.length > 350000 ||
                !value.startsWith("/9j/") || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))) throw new Error("La copia contiene una miniatura inválida.");
            if (!["string","number"].includes(typeof value) && value !== null)
              throw new Error("La copia contiene un valor inválido.");
            return value;
          }));
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function exportCsv(path, type) {
    const queries = {
      links:"SELECT l.title, l.url, l.service, l.kind, l.expires_at, l.download_status, p.title AS project FROM links l JOIN projects p ON p.id=l.project_id WHERE l.archived_at IS NULL ORDER BY l.created_at DESC",
      deliveries:"SELECT d.version, p.title AS project, l.url, d.delivered_at, d.notes FROM deliveries d JOIN projects p ON p.id=d.project_id LEFT JOIN links l ON l.id=d.link_id WHERE d.archived_at IS NULL ORDER BY d.delivered_at DESC",
    };
    if (!Object.hasOwn(queries, type)) throw new Error("Tipo de exportación inválido.");
    const statement = db.prepare(queries[type]);
    writeFileSync(path, csv(statement.all(), statement.columns().map(({name}) => name)), "utf8");
  }

  function rotate(directory, count) {
    const manifest = /^Capricorn-auto-\d{8}-\d{6}-[a-f0-9]{8}\.capricorn$/;
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T","-").slice(0,15);
    writeArchive(join(directory, "Capricorn-auto-" + timestamp + "-" + randomUUID().slice(0,8) + ".capricorn"));
    const files = readdirSync(directory).filter((name) => manifest.test(name)).sort().reverse();
    for (const name of files.slice(count)) unlinkSync(join(directory, name));
  }

  return { writeArchive, restoreArchive, exportCsv, rotate };
}

module.exports = { archives };
