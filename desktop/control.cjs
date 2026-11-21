const { randomUUID } = require("node:crypto");

function calendarDate(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0")).join("-");
}

function control(db) {
  const currentProject = "SELECT p.id FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.id=? AND p.archived_at IS NULL AND c.archived_at IS NULL";
  const activeLink = "SELECT l.* FROM links l JOIN projects p ON p.id=l.project_id JOIN clients c ON c.id=p.client_id WHERE l.id=? AND l.archived_at IS NULL AND p.archived_at IS NULL AND c.archived_at IS NULL";

  function requireProject(id) {
    if (!db.prepare(currentProject).get(id)) throw new Error("El proyecto ya no está disponible.");
  }

  function projectDetails(id) {
    const payment = db.prepare("SELECT price, 'USD' AS currency, payment_status FROM projects WHERE id IN (" + currentProject + ")").get(id);
    if (!payment) throw new Error("El proyecto ya no está disponible.");
    return {
      payment,
      nextVersion:db.prepare("SELECT COALESCE(MAX(version),0)+1 AS version FROM deliveries WHERE project_id=?").get(id).version,
      deliveries: db.prepare("SELECT * FROM deliveries WHERE project_id=? AND archived_at IS NULL ORDER BY version DESC").all(id),
      revisions: db.prepare(
        "SELECT r.*, d.version AS delivery_version, d.archived_at IS NOT NULL AS delivery_withdrawn FROM revisions r " +
        "LEFT JOIN deliveries d ON d.id=r.delivery_id WHERE r.project_id=? AND r.archived_at IS NULL ORDER BY r.created_at DESC, r.rowid DESC"
      ).all(id),
    };
  }

  function savePayment({ id, price, payment_status }) {
    if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0 || Number(price.toFixed(2)) !== price))
      throw new Error("Introduce un importe válido en USD, con hasta dos decimales.");
    if (!["pending","partial","paid"].includes(payment_status)) throw new Error("Estado de pago inválido.");
    if (!db.prepare("UPDATE projects SET price=?, currency='USD', payment_status=? WHERE id IN (" + currentProject + ")")
      .run(price, payment_status, id).changes) throw new Error("El proyecto ya no está disponible.");
  }

  function deliveryLink(projectId, linkId, previous) {
    if (linkId && linkId !== previous &&
        !db.prepare("SELECT id FROM links WHERE id=? AND project_id=? AND kind='delivery' AND archived_at IS NULL").get(linkId, projectId))
      throw new Error("Selecciona un enlace de entrega del proyecto.");
    return linkId || null;
  }

  function deliveryDate(value) {
    const date = value === undefined ? new Date() : new Date(value);
    if ((value !== undefined && typeof value !== "string") || !Number.isFinite(date.getTime()))
      throw new Error("Selecciona la fecha y hora de entrega.");
    return date.toISOString();
  }

  function createDelivery({ id, linkId, notes, deliveredAt }) {
    requireProject(id);
    const link = deliveryLink(id, linkId);
    return db.prepare(
      "INSERT INTO deliveries(id,project_id,version,link_id,delivered_at,notes) SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,? FROM deliveries WHERE project_id=? RETURNING id,version"
    ).get(randomUUID(), id, link, deliveryDate(deliveredAt), optionalText(notes), id);
  }

  function existingRecord(table, id, projectId) {
    requireProject(projectId);
    const record = db.prepare("SELECT * FROM " + table + " WHERE id=? AND project_id=? AND archived_at IS NULL").get(id, projectId);
    if (!record) throw new Error("El registro ya no está disponible.");
    return record;
  }

  function editDelivery({ id, projectId, linkId, deliveredAt, notes }) {
    const current = existingRecord("deliveries", id, projectId);
    db.prepare("UPDATE deliveries SET link_id=?,delivered_at=?,notes=?,updated_at=? WHERE id=?")
      .run(deliveryLink(projectId, linkId, current.link_id), deliveryDate(deliveredAt), optionalText(notes), new Date().toISOString(), id);
  }

  function removeDelivery({ id, projectId }) {
    existingRecord("deliveries", id, projectId);
    db.prepare("UPDATE deliveries SET archived_at=? WHERE id=?").run(new Date().toISOString(), id);
  }

  function revisionDescription(text) {
    if (typeof text !== "string" || !text.trim()) throw new Error("Escribe la revisión.");
    return text.trim();
  }

  function revisionDelivery(projectId, deliveryId, previous) {
    if (deliveryId && deliveryId !== previous &&
        !db.prepare("SELECT id FROM deliveries WHERE id=? AND project_id=? AND archived_at IS NULL").get(deliveryId, projectId))
      throw new Error("Selecciona una entrega de este proyecto.");
    return deliveryId || null;
  }

  function createRevision({ id, deliveryId, text }) {
    requireProject(id);
    db.prepare("INSERT INTO revisions(id,project_id,delivery_id,text,created_at) VALUES (?,?,?,?,?)")
      .run(randomUUID(), id, revisionDelivery(id, deliveryId), revisionDescription(text), new Date().toISOString());
  }

  function editRevision({ id, projectId, deliveryId, text }) {
    const current = existingRecord("revisions", id, projectId);
    db.prepare("UPDATE revisions SET delivery_id=?,text=?,updated_at=? WHERE id=?")
      .run(revisionDelivery(projectId, deliveryId, current.delivery_id), revisionDescription(text), new Date().toISOString(), id);
  }

  function updateRevision({ id, projectId, done }) {
    if (typeof done !== "boolean") throw new Error("Estado de revisión inválido.");
    existingRecord("revisions", id, projectId);
    db.prepare("UPDATE revisions SET done_at=CASE WHEN done=? THEN done_at ELSE ? END, done=? WHERE id=?")
      .run(Number(done), done ? new Date().toISOString() : null, Number(done), id);
  }

  function removeRevision({ id, projectId }) {
    existingRecord("revisions", id, projectId);
    db.prepare("UPDATE revisions SET archived_at=? WHERE id=?").run(new Date().toISOString(), id);
  }

  function findLink(id) {
    const link = db.prepare(activeLink).get(id);
    if (!link) throw new Error("El enlace ya no está disponible.");
    return link;
  }

  function saveLinkHealth(id, url, health) {
    db.prepare("UPDATE links SET last_checked_at=?,health=? WHERE id=? AND url=?")
      .run(new Date().toISOString(), health, id, url);
  }

  function setSecretFlag(id, stored) {
    db.prepare("UPDATE links SET password_ref=? WHERE id=?").run(stored ? id : null, id);
  }

  function dueLinks(days) {
    const today = new Date();
    const through = new Date(today);
    through.setDate(today.getDate() + days);
    return db.prepare(
      "SELECT l.id,l.title,l.expires_at FROM links l JOIN projects p ON p.id=l.project_id JOIN clients c ON c.id=p.client_id " +
      "WHERE l.kind='material' AND l.download_status='pending' AND l.expires_at BETWEEN ? AND ? " +
      "AND l.archived_at IS NULL AND p.archived_at IS NULL AND p.status<>'archived' AND c.archived_at IS NULL ORDER BY l.expires_at"
    ).all(calendarDate(today), calendarDate(through));
  }

  function getSetting(key, fallback) {
    const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : fallback;
  }

  function putSetting(key, value) {
    db.prepare("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
  }

  return { projectDetails, savePayment, createDelivery, editDelivery, removeDelivery, createRevision, editRevision, updateRevision, removeRevision, findLink,
    saveLinkHealth, setSecretFlag, dueLinks, getSetting, putSetting };
}

function optionalText(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

module.exports = { control, calendarDate };
