const { publicRequest } = require("./public-network.cjs");
const platforms = require("./social-platforms.json");
const { prepareSocialUrl } = require("./socials.cjs");

const providers = {
  twitch: { name:"Twitch", id:"67f35d90-7fca-487d-820f-71730e87d7bb" },
  kick: { name:"Kick", id:"67f35d90-7fca-487d-820f-71730e87d7bc" },
  youtube: { name:"YouTube", id:"67f35d90-7fca-487d-820f-71730e87d7bd" },
};

function unwrap(address) {
  const url = new URL(address);
  return ["www.youtube.com","youtube.com"].includes(url.hostname) && url.pathname === "/redirect"
    ? url.searchParams.get("q") ?? "" : address;
}

function urls(text) {
  return Array.from(text.replace(/&amp;|&#38;/gi, "&").matchAll(/https?:\/\/[^\s"'<>\\]+/gi),
    (match) => match[0].replace(/[),.;\]}]+$/, ""));
}

function candidateKey(value) {
  const url = new URL(value);
  return url.hostname.replace(/^www\./,"") + url.pathname.replace(/\/(?:about\/?)?$/, "") +
    (url.pathname.endsWith("profile.php") ? "?" + (url.searchParams.get("id") ?? "") : "");
}

function candidates(text, webUrl) {
  const found = new Map();
  for (const address of urls(text)) {
    try {
      const profile = prepareSocialUrl(unwrap(address), webUrl);
      if (profile.platform === "web" || new URL(profile.url).pathname === "/") continue;
      const id = candidateKey(profile.url);
      if (!found.has(id)) found.set(id, profile);
    } catch { /* Ignore malformed URLs. */ }
    if (found.size >= 40) break;
  }
  return [...found.values()];
}

function konectUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "konect.gg" && !url.username && !url.password && !url.port &&
        /^\/[a-z0-9_-]{2,80}\/?$/i.test(url.pathname)) return new URL(url.pathname, "https://konect.gg");
  } catch { /* Unsupported link hub. */ }
  return null;
}

function sourceOf(value, webUrl) {
  const { platform, url } = prepareSocialUrl(value, webUrl);
  const hub = konectUrl(url);
  if (hub) return { platform:"konect", page:hub.href };
  const [first, second] = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);
  if (platform === "youtube" && new URL(url).hostname.endsWith("youtube.com")) {
    const handle = /^@[\p{L}\p{N}._-]+$/u.test(first ?? "");
    const legacy = ["user", "channel", "c"].includes(first) && /^[\p{L}\p{N}._-]+$/u.test(second ?? "");
    if (handle || legacy) return {
      platform, page:new URL((handle ? "/" + first : "/" + first + "/" + second) + "/about", "https://www.youtube.com").href,
      key:handle ? "forHandle" : first === "user" ? "forUsername" : first === "channel" ? "id" : null,
      value:handle ? first : second,
    };
  }
  if (["twitch","kick"].includes(platform) && /^[a-z0-9_][a-z0-9_-]{1,49}$/i.test(first ?? "") &&
      (!second || second === "about") && !["directory","videos","settings","following","categories","search","browse"].includes(first.toLowerCase())) {
    const base = platform === "kick" ? "https://kick.com" : "https://www.twitch.tv";
    return { platform, value:first.toLowerCase(), page:base + "/" + first + "/about" };
  }
  throw new Error("Pega la URL de un canal de Twitch, Kick o YouTube, o de un perfil de Konect.");
}

function apiRequest(source, settings) {
  if (source.platform === "twitch") return {
    url:"https://api.twitch.tv/helix/users?" + new URLSearchParams({ login:source.value }),
    headers:{ Authorization:"Bearer " + settings.token, "Client-Id":settings.clientId },
    description:(data) => data.data?.[0]?.description,
  };
  if (source.platform === "kick") return {
    url:"https://api.kick.com/public/v1/channels?" + new URLSearchParams({ slug:source.value }),
    headers:{ Authorization:"Bearer " + settings.token },
    description:(data) => data.data?.[0]?.channel_description,
  };
  return {
    url:"https://www.googleapis.com/youtube/v3/channels?" +
      new URLSearchParams({ part:"snippet", [source.key]:source.value, fields:"items(snippet(description))" }),
    headers:{ "X-Goog-Api-Key":settings.token },
    description:(data) => data.items?.[0]?.snippet?.description,
  };
}

async function readLimited(response) {
  if (!response.body) throw new Error("Respuesta vacía");
  const parts = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error("Respuesta demasiado grande");
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

function handleVariants(value) {
  if (!value) return [];
  const name = value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._-]{2,50}$/.test(name)) return [];
  return [...new Set([name, name.replace(/[._-]+/g, ""), name.replace(/[._-]+/g, "_")])]
    .filter((item) => item.length >= 2);
}

async function verifyProfiles(profiles, request = publicRequest) {
  const listedHosts = new Set(Object.values(platforms).flat());
  const checked = profiles.map((profile) => ({ ...profile, health:"unknown" }));
  const signal = AbortSignal.timeout(8500);
  let cursor = 0;
  async function next() {
    while (cursor < checked.length && !signal.aborted) {
      const profile = checked[cursor++];
      const url = new URL(profile.url);
      const host = url.hostname.replace(/^www\./, "");
      if (url.protocol !== "https:" || url.port || !listedHosts.has(host)) continue;
      try {
        const response = await request(url, { method:"HEAD", redirect:"manual", signal:AbortSignal.any([signal, AbortSignal.timeout(3400)]) });
        if (response.status === 404 || response.status === 410) profile.health = "broken";
        else if (response.ok) profile.health = "ok";
        await response.body?.cancel();
      } catch { /* Network failures are inconclusive. */ }
    }
  }
  await Promise.all(Array.from({ length:Math.min(5, checked.length) }, next));
  return checked;
}

async function discover(value, webUrl, readCredential, request = publicRequest) {
  const source = sourceOf(value, webUrl);
  const signal = AbortSignal.timeout(12000);
  const found = new Map();
  const result = { page:source.page, profiles:[], status:"ok" };
  const add = (text, origin) => {
    for (const profile of candidates(text, webUrl)) {
      const id = candidateKey(profile.url);
      if (id !== candidateKey(source.page) && !found.has(id) && found.size < 40) found.set(id, { ...profile, origin });
    }
  };
  async function addKonect(url, requireBacklink = false) {
    const response = await request(url, { signal, redirect:"error", headers:{ Accept:"text/html" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error("Konect no disponible");
    const html = await readLimited(response);
    const links = Array.from(html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi), (match) => match[1]);
    const text = links.join("\n");
    if (requireBacklink && !candidates(text, webUrl).some((profile) => candidateKey(profile.url) === candidateKey(source.page)))
      return false;
    add(text, requireBacklink ? "Konect · mismo canal" : "Konect");
    return true;
  }
  if (source.platform === "konect") {
    try { await addKonect(source.page); } catch { result.status = "unavailable"; }
  } else {
    const handles = source.platform === "youtube" && source.key !== "forHandle" && source.key !== "forUsername"
      ? [] : handleVariants(source.value);
    const attempts = handles.map((handle) => konectUrl("https://konect.gg/" + handle)).filter(Boolean);
    await Promise.allSettled(attempts.map((hub) => addKonect(hub.href, true)));
    if (!found.size && (source.platform !== "youtube" || source.key)) {
      const provider = providers[source.platform];
      try {
        const raw = await readCredential(provider.id);
        if (raw) {
          const query = apiRequest(source, JSON.parse(raw));
          const response = await request(query.url, { headers:query.headers, redirect:"error", signal });
          if ([401,403].includes(response.status)) result.status = "authorization";
          else if (!response.ok) result.status = "unavailable";
          else {
            const description = query.description(JSON.parse(await readLimited(response)));
            if (typeof description === "string") {
              add(description, provider.name + " · Descripción");
              const hubs = [...new Set(urls(description).map(konectUrl).filter(Boolean).map((url) => url.href))].slice(0,2);
              const supplemental = await Promise.allSettled(hubs.map((hub) => addKonect(hub)));
              if (supplemental.some((item) => item.status === "rejected")) result.status = "partial";
            }
          }
        }
      } catch { result.status = "unavailable"; }
    }
    if (!found.size && handles.length) {
      const guesses = [];
      for (const handle of handles) {
        guesses.push("https://www.instagram.com/" + handle, "https://www.tiktok.com/@" + handle,
          "https://www.youtube.com/@" + handle, "https://kick.com/" + handle, "https://www.twitch.tv/" + handle,
          "https://x.com/" + handle);
      }
      for (const profile of candidates(guesses.join("\n"), webUrl)) {
        const id = candidateKey(profile.url);
        if (id !== candidateKey(source.page)) found.set(id, { ...profile, origin:"Coincidencia de nombre", guessed:true });
      }
      if (found.size) result.status = "guesses";
    }
  }
  result.profiles = (await verifyProfiles([...found.values()], request)).filter((profile) => !profile.guessed || profile.health !== "broken");
  if (result.status === "guesses" && !result.profiles.length) result.status = "ok";
  return result;
}

module.exports = { discover, candidates, providers, verifyProfiles, sourceOf, candidateKey, handleVariants };