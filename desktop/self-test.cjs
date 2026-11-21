const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { connect, webUrl } = require("./store.cjs");

function selfTest() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "capricorn-test-"));
  const filename = path.join(directory, "capricorn.sqlite3");
  let db;
  try {
    const legacy = new DatabaseSync(filename);
    legacy.exec(fs.readFileSync(path.join(__dirname, "001.sql"), "utf8"));
    legacy.prepare("INSERT INTO clients(id,name) VALUES (?,?)").run("legacy", "Cliente anterior");
    legacy.close();
    db = connect(filename);
    assert.equal(db.snapshot().clients[0].name, "Cliente anterior");
    const client = db.save({ entity:"client", name:"López" });
    const social = db.saveSocial({ clientId:client, url:"instagram.com/estudio", label:"Principal" });
    assert.equal(db.snapshot().socials[0].platform, "instagram");
    assert.equal(db.snapshot().socials[0].url, "https://instagram.com/estudio");
    assert.throws(() => db.saveSocial({ clientId:client, url:"https://instagram.com/estudio" }), /guardado/);
    assert.throws(() => db.saveSocial({ clientId:client, url:"javascript:alert(1)" }), /válida/);
    db.saveSocial({ clientId:client, id:social, url:"https://linkedin.com/company/estudio", label:"Equipo" });
    assert.equal(db.snapshot().socials[0].platform, "linkedin");
    const project = db.save({ entity:"project", client_id:client, title:"Montaje", status:"received" });
    for (const url of ["https://drive.google.com/file/1", "https://dropbox.com/s/2", "https://we.tl/t-3"]) {
      db.save({ entity:"link", project_id:project, kind:"material", title:"Material", url, download_status:"pending" });
    }
    db.changeProjectStatus(project, "review");
    db.theme("system");
    assert.throws(() => webUrl("file:///C:/Windows"));
    db.close();
    db = undefined;
    db = connect(filename);
    const { projects, links } = db.snapshot();
    assert.equal(projects[0].status, "review");
    assert.equal(db.theme(), "system");
    assert.deepEqual(new Set(links.map((link) => link.service)), new Set(["drive", "dropbox", "wetransfer"]));
    db.savePayment({ id:project, price:3500, payment_status:"partial" });
    const deliveryLink = db.save({
      entity:"link", project_id:project, kind:"delivery", title:"Entrega", url:"https://example.com/delivery",
      download_status:"pending",
    });
    db.createDelivery({ id:project, linkId:deliveryLink, notes:"Primer corte" });
    db.createDelivery({ id:project, linkId:deliveryLink, notes:"Corte final" });
    const { deliveries, payment } = db.projectDetails(project);
    assert.deepEqual(deliveries.map((delivery) => delivery.version), [2,1]);
    assert.equal(payment.payment_status, "partial");
    assert.equal(payment.currency, "USD");
    db.createRevision({ id:project, deliveryId:deliveries[0].id, text:"Ajustar títulos" });
    const revision = db.projectDetails(project).revisions[0];
    db.updateRevision({ id:revision.id, projectId:project, done:true });
    assert.equal(db.projectDetails(project).revisions[0].done, 1);
    db.setSecretFlag(deliveryLink, true);
    db.setThumbnail(deliveryLink, "/9j/AA==");
    const batch = db.addLinks({ projectId:project, kind:"reference",
      text:["https://example.org/referencia","https://example.org/referencia","https://example.org/montaje.mp4"].join("\n") });
    assert.deepEqual(batch, { count:2, skipped:1 });
    assert.throws(() => db.addLinks({ projectId:project, kind:"reference", text:"https://example.org/valida\nfile:///C:/temp" }), /línea 2/);
    assert.equal(db.snapshot().links.filter((link) => link.kind === "reference").length, 2);
    const backup = path.join(directory, "backup.capricorn");
    const csvFile = path.join(directory, "deliveries.csv");
    db.writeArchive(backup);
    db.exportCsv(csvFile, "deliveries");
    assert.match(fs.readFileSync(csvFile, "utf8"), /Corte final/);
    db.archive("client", client);
    assert.equal(db.snapshot().links.length, 0);
    assert.equal(db.snapshot().socials.length, 0);
    db.restoreArchive(backup);
    assert.equal(db.snapshot().socials[0].label, "Equipo");
    db.removeSocial({ clientId:client, id:social });
    assert.equal(db.snapshot().socials.length, 0);
    assert.equal(db.projectDetails(project).revisions[0].done, 1);
    assert.equal(db.snapshot().links.find((link) => link.id === deliveryLink).has_password, 1);
    assert.equal(db.getThumbnail(deliveryLink), "/9j/AA==");
    db.editRevision({ id:revision.id, projectId:project, deliveryId:deliveries[0].id, text:"Corregir títulos" });
    assert.equal(db.projectDetails(project).revisions[0].text, "Corregir títulos");
    assert.equal(db.projectDetails(project).revisions[0].done, 1);
    db.editDelivery({ id:deliveries[0].id, projectId:project, deliveredAt:"2026-05-03T08:30:00Z", notes:"Envío corregido" });
    assert.equal(db.projectDetails(project).deliveries[0].delivered_at, "2026-05-03T08:30:00.000Z");
    db.removeDelivery({ id:deliveries[0].id, projectId:project });
    assert.equal(db.projectDetails(project).revisions[0].delivery_withdrawn, 1);
    assert.equal(db.projectDetails(project).revisions[0].delivery_version, 2);
    assert.equal(db.createDelivery({ id:project }).version, 3);
    db.removeRevision({ id:revision.id, projectId:project });
    assert.equal(db.projectDetails(project).revisions.length, 0);
    assert.throws(() => db.editRevision({ id:revision.id, projectId:project, text:"Intento" }), /ya no está disponible/);
    const active = db.snapshot().links.find((link) => link.id === deliveryLink);
    db.save({ ...active, entity:"link", url:"https://example.com/other" });
    assert.equal(db.getThumbnail(deliveryLink), null);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive:true, force:true });
  }
}
module.exports = { selfTest };
