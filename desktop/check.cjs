const { publicRequest } = require("./public-network.cjs");
const { calendarDate } = require("./control.cjs");
const { webUrl } = require("./store.cjs");

async function requestStatus(url, signal) {
  const options = { redirect:"follow", cache:"no-store", signal, credentials:"omit" };
  let response = await publicRequest(url, { ...options, method:"HEAD" });
  if ([405, 501].includes(response.status)) {
    response = await publicRequest(url, { ...options, headers:{ Range:"bytes=0-0" } });
    await response.body?.cancel();
  }
  return response.status;
}

async function checkLink(db, id) {
  const link = db.findLink(id);
  if (link.expires_at && link.expires_at < calendarDate()) {
    db.saveLinkHealth(id, link.url, "expired");
    return { health:"expired", status:null };
  }
  let status = null;
  let health = "unknown";
  try {
    status = await requestStatus(webUrl(link.url), AbortSignal.timeout(8000));
    if (status >= 200 && status < 300) health = "ok";
    else if ([404, 410].includes(status)) health = "broken";
  } catch {
    // Transport errors and protected links leave the result inconclusive.
  }
  db.saveLinkHealth(id, link.url, health);
  return { health, status };
}

module.exports = { checkLink };
