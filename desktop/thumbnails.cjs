const { publicRequest } = require("./public-network.cjs");
const { readFileSync, statSync } = require("node:fs");

const remoteLimit = 2 * 1024 * 1024;
const localLimit = 12 * 1024 * 1024;

function driveThumbnailUrl(value) {
  const original = new URL(value);
  if (original.protocol !== "https:" || original.hostname !== "drive.google.com") return null;
  const pattern = /^\/file\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/;
  const id = original.pathname.match(pattern)?.[1] ??
    (["/open", "/uc"].includes(original.pathname) ? original.searchParams.get("id") : null);
  if (!id || !/^[a-zA-Z0-9_-]{5,150}$/.test(id)) return null;
  const url = new URL("https://drive.google.com/thumbnail");
  url.searchParams.set("id", id);
  url.searchParams.set("sz", "w480");
  const key = original.searchParams.get("resourcekey");
  if (key && /^[a-zA-Z0-9_-]{1,200}$/.test(key)) url.searchParams.set("resourcekey", key);
  return url;
}

function googleImageHost(url) {
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    (url.hostname === "drive.google.com" || url.hostname.endsWith(".googleusercontent.com"));
}

async function driveImage(url, request = publicRequest) {
  let target = driveThumbnailUrl(url);
  if (!target) throw new Error("La miniatura de Drive requiere un enlace HTTPS a un archivo individual.");
  const signal = AbortSignal.timeout(9000);
  for (let hops = 0; hops < 5; hops++) {
    const response = await request(target, { redirect:"manual", signal, credentials:"omit", headers:{ Accept:"image/jpeg,image/png" } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) break;
      target = new URL(location, target);
      if (!googleImageHost(target)) break;
      continue;
    }
    const length = Number(response.headers.get("content-length"));
    if (!response.ok || !/^image\/(?:png|jpeg)(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
        (Number.isFinite(length) && length > remoteLimit) || !response.body) {
      await response.body?.cancel();
      break;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > remoteLimit) {
        await reader.cancel();
        throw new Error("La miniatura de Drive supera el límite permitido.");
      }
      chunks.push(value);
    }
  }
  throw new Error("Drive no devolvió una miniatura accesible. Si el archivo es privado, puedes elegir una imagen local.");
}

function localImage(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > localLimit) throw new Error("Elige una imagen de hasta 12 MB.");
  return readFileSync(path);
}

function toThumbnail(image, bytes) {
  const type = bytes.subarray(0,12);
  const supported = type.subarray(0,3).equals(Buffer.from([255,216,255])) ||
    type.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!supported) throw new Error("Elige una imagen JPG o PNG.");
  const original = image.createFromBuffer(bytes);
  if (original.isEmpty()) throw new Error("No se pudo leer la imagen.");
  const { width, height } = original.getSize();
  const scale = Math.min(1, 480 / width, 360 / height);
  const resized = original.resize({ width:Math.max(1, Math.round(width * scale)), height:Math.max(1, Math.round(height * scale)), quality:"good" });
  const jpeg = resized.toJPEG(78).toString("base64");
  if (jpeg.length > 350000) throw new Error("La miniatura supera el límite permitido.");
  return jpeg;
}

module.exports = { driveThumbnailUrl, driveImage, localImage, toThumbnail };