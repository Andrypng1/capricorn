const { randomUUID } = require("node:crypto");

function payments(db) {
  function savePaymentReceipt({ id, clientId, projectId, amount, platform, receivedOn, note }) {
    const current = id ? db.prepare("SELECT * FROM payments WHERE id=? AND archived_at IS NULL").get(id) : null;
    if (id && !current) throw new Error("El pago ya no está disponible.");
    if (!db.prepare("SELECT 1 FROM clients WHERE id=? AND (archived_at IS NULL OR id=?)").get(clientId,current?.client_id ?? null))
      throw new Error("Selecciona un cliente disponible.");
    if (projectId && !db.prepare("SELECT 1 FROM projects WHERE id=? AND client_id=? AND (archived_at IS NULL OR id=?)")
      .get(projectId, clientId, current?.project_id ?? null)) throw new Error("Selecciona un proyecto de ese cliente.");
    const text = typeof amount === "string" ? amount.trim().replace(",", ".") : "";
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) throw new Error("Introduce un importe en USD con hasta dos decimales.");
    const [whole, fraction = ""] = text.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2,"0"));
    if (!cents) throw new Error("El importe debe ser mayor que cero.");
    if (typeof receivedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn))
      throw new Error("Selecciona una fecha de pago válida.");
    const date = new Date(receivedOn + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== receivedOn)
      throw new Error("Selecciona una fecha de pago válida.");
    const method = typeof platform === "string" ? platform.trim() : "";
    if (!method || method.length > 80) throw new Error("Indica una plataforma de pago.");
    const memo = typeof note === "string" ? note.trim() : "";
    if (memo.length > 500) throw new Error("La referencia debe tener hasta 500 caracteres.");
    const key = id || randomUUID();
    const values = [clientId, projectId || null, cents, method, receivedOn, memo || null];
    if (id) db.prepare("UPDATE payments SET client_id=?,project_id=?,cents=?,platform=?,received_on=?,note=? WHERE id=?").run(...values,key);
    else db.prepare("INSERT INTO payments(client_id,project_id,cents,platform,received_on,note,id,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(...values,key,new Date().toISOString());
    return key;
  }
  function removePaymentReceipt(id) {
    if (!db.prepare("UPDATE payments SET archived_at=? WHERE id=? AND archived_at IS NULL")
      .run(new Date().toISOString(), id).changes) throw new Error("El pago ya no está disponible.");
  }
  return { savePaymentReceipt, removePaymentReceipt };
}

module.exports = { payments };