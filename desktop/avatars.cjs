const { publicRequest } = require("./public-network.cjs");
const { providers, sourceOf, candidateKey, handleVariants, candidates } = require("./social-discovery.cjs");

function allowedHost(url, storage = false) {
  const host = url.hostname;
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    (["api.konect.gg","konect.gg","static-cdn.jtvnw.net","yt3.googleusercontent.com","yt3.ggpht.com","files.kick.com"].includes(host) ||
      ["cdninstagram.com","fbcdn.net"].some((domain) => host === domain || host.endsWith("." + domain)) || (storage && [".digitaloceanspaces.com",".amazonaws.com",".cloudfront.net",".r2.dev"].some((suffix) => host.endsWith(suffix))));
}

async function body(response, limit) {
  if (!response.ok || !response.body) throw new Error("No se pudo descargar la imagen.");
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error("La respuesta supera el límite permitido.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function imageFromUrl(value, request = publicRequest) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Pega la dirección HTTPS de la imagen."); }
  const signal = AbortSignal.timeout(9000);
  const konectStorage = url.hostname === "api.konect.gg";
  for (let i = 0; i < 4 && allowedHost(url, i > 0 && konectStorage); i++) {
    const reply = await request(url, { signal, redirect:"manual", headers:{ Accept:"image/jpeg,image/png,image/webp" } });
    if ([301,302,303,307,308].includes(reply.status)) {
      const target = reply.headers.get("location");
      await reply.body?.cancel();
      if (!target) break;
      url = new URL(target, url);
      continue;
    }
    if (!/^image\/(?:png|jpeg|webp)(?:;|$)/i.test(reply.headers.get("content-type") ?? "")) {
      await reply.body?.cancel();
      break;
    }
    return body(reply, 3 * 1024 * 1024);
  }
  throw new Error("La red no ofreció una imagen accesible. Puedes cargar una imagen local.");
}

function konectAvatar(page, base) {
  const links = Array.from(page.matchAll(/<img\b[^>]*>/gi));
  const avatar = links.find(([tag]) => /\balt=["'][^"']*avatar/i.test(tag));
  const src = avatar?.[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (src) return new URL(src.replace(/&amp;/g,"&"),base).href;
  for (const [tag] of page.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\bproperty=["']og:image["']/i.test(tag)) continue;
    const address = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (!address) continue;
    const url = new URL(address.replace(/&amp;/g,"&"),base);
    if (url.hostname === "api.konect.gg" && url.pathname.includes("/active_storage/")) return url.href;
  }
  return null;
}

async function publicKonect(url, signal, request, expected, webUrl) {
  const reply = await request(url, { signal, redirect:"error" });
  const page = (await body(reply, 3 * 1024 * 1024)).toString("utf8");
  if (expected) {
    const links = Array.from(page.matchAll(/<a\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi), (match) => match[1]);
    if (!candidates(links.join("\n"), webUrl).some(({ url }) => candidateKey(url) === expected)) return null;
  }
  const address = konectAvatar(page, url);
  return address ? imageFromUrl(address, request) : null;
}

async function profileImage(profile, webUrl, readCredential, request = publicRequest) {
  const { platform, url } = profile;
  const signal = AbortSignal.timeout(6500);
  let source;
  try { source = sourceOf(url, webUrl); } catch { /* Some networks are supported through a matching Konect profile only. */ }
  if (source?.platform === "konect") {
    const image = await publicKonect(source.page, signal, request);
    if (image) return image;
    throw new Error("Konect no mostró una foto accesible. Puedes pegar una imagen.");
  }

  const pathname = new URL(url).pathname.split("/").filter(Boolean);
  const name = source?.value ?? (pathname.length === 1 ? decodeURIComponent(pathname[0]) : "");
  const handles = ["instagram","tiktok","twitch","kick","youtube","x","threads","behance","facebook"].includes(platform) &&
    !(platform === "youtube" && source?.key === "id") ? handleVariants(name) : [];
  if (handles.length) {
    const matched = await Promise.allSettled(handles.map((handle) => publicKonect(
      "https://konect.gg/" + encodeURIComponent(handle), signal, request, candidateKey(url), webUrl
    )));
    const image = matched.find((entry) => entry.status === "fulfilled" && entry.value);
    if (image) return image.value;
  }

  if (!source || !["twitch","youtube"].includes(source.platform) || (source.platform === "youtube" && !source.key))
    throw new Error("No encontré una foto disponible para esa cuenta. Abre el perfil, copia la imagen y pulsa Pegar foto.");
  const raw = await readCredential(providers[source.platform].id);
  if (!raw) throw new Error("Configura la credencial de la red en Ajustes, o carga una foto local.");
  const settings = JSON.parse(raw);
  const twitch = source.platform === "twitch";
  const apiUrl = twitch ? "https://api.twitch.tv/helix/users?" + new URLSearchParams({ login:source.value }) :
    "https://www.googleapis.com/youtube/v3/channels?" + new URLSearchParams({
      part:"snippet", [source.key]:source.value, fields:"items(snippet(thumbnails))",
    });
  const headers = twitch ? { Authorization:"Bearer " + settings.token, "Client-Id":settings.clientId }
    : { "X-Goog-Api-Key":settings.token };
  const reply = await request(apiUrl, { headers, signal:AbortSignal.timeout(6500), redirect:"error" });
  if ([401,403].includes(reply.status)) throw new Error("La red rechazó la credencial. Puedes renovarla en Ajustes.");
  const data = JSON.parse((await body(reply, 512 * 1024)).toString("utf8"));
  const thumbnails = data.items?.[0]?.snippet?.thumbnails;
  const address = twitch ? data.data?.[0]?.profile_image_url : thumbnails?.medium?.url ?? thumbnails?.default?.url;
  if (!address) throw new Error("El perfil no devolvió una foto.");
  return imageFromUrl(address, request);
}

module.exports = { profileImage, imageFromUrl };