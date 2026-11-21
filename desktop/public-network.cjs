const { lookup } = require("node:dns").promises;
const { request: http } = require("node:http");
const { request: https } = require("node:https");
const { isIP } = require("node:net");
const { Readable } = require("node:stream");
const { createBrotliDecompress, createGunzip, createInflate } = require("node:zlib");

const redirects = new Set([301,302,303,307,308]);
const decoders = new Map([["gzip",createGunzip],["deflate",createInflate],["br",createBrotliDecompress]]);

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes("%")) return false;
  const canonical = new URL("http://[" + address + "]").hostname.slice(1,-1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) {
    const high = Number.parseInt(mapped[1],16), low = Number.parseInt(mapped[2],16);
    return publicAddress([high >> 8,high & 255,low >> 8,low & 255].join("."));
  }
  const first = Number.parseInt(canonical.split(":")[0],16);
  // Only global unicast. Exclude special-purpose ranges inside that allocation.
  return first >= 0x2000 && first <= 0x3fff &&
    !/^(2001:(?:[0-9a-f]{1,2}:|db8:)|2002:|3fff:)/.test(canonical);
}

function publicTarget(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g,"").replace(/\.$/,"").toLowerCase();
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || !host ||
    (isIP(host) ? !publicAddress(host) : !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/.test(host))) {
    throw new Error("La conexión requiere un destino público HTTP o HTTPS.");
  }
  return url;
}

function publicLookup(resolve = lookup) {
  return (hostname, options, callback) => {
    Promise.resolve().then(() => resolve(hostname,{ all:true, verbatim:true })).then((addresses) => {
      if (!addresses.length || addresses.some(({ address,family }) => isIP(address) !== family || !publicAddress(address)))
        throw new Error("El DNS no devolvió exclusivamente direcciones públicas.");
      const matching = options.family ? addresses.filter(({ family }) => family === options.family) : addresses;
      if (!matching.length) throw new Error("El DNS no devolvió una dirección compatible.");
      if (options.all) callback(null,matching);
      else callback(null,matching[0].address,matching[0].family);
    }).catch(callback);
  };
}

function requestOnce(url, options) {
  return new Promise((resolve,reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport(url,{
      method:options.method, headers:Object.fromEntries(options.headers), signal:options.signal,
      lookup:publicLookup(), agent:false,
    },(incoming) => {
      const headers = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2)
        headers.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
      const status = incoming.statusCode;
      const noBody = options.method === "HEAD" || status === 204 || status === 205 || status === 304;
      const decoder = decoders.get(headers.get("content-encoding")?.toLowerCase());
      let stream = incoming;
      if (noBody) incoming.resume();
      else if (typeof decoder === "function") {
        stream = decoder();
        incoming.on("error",(error) => stream.destroy(error));
        stream.on("close",() => incoming.destroy());
        incoming.pipe(stream);
      }
      const body = noBody ? null : Readable.toWeb(stream);
      resolve({ status, ok:status >= 200 && status < 300, headers, body });
    });
    request.on("error",reject);
    request.end();
  });
}

async function publicRequest(value, options = {}, transport = requestOnce) {
  let url = publicTarget(value);
  const headers = new Headers(options.headers);
  if (!headers.has("accept")) headers.set("accept","*/*");
  if (!headers.has("user-agent")) headers.set("user-agent","node");
  if (!headers.has("accept-encoding")) headers.set("accept-encoding","gzip, deflate, br");
  const method = (options.method ?? "GET").toUpperCase();
  const redirect = options.redirect ?? "follow";
  if (options.cache === "no-store") headers.set("cache-control","no-cache");
  for (let hops = 0; ; hops++) {
    const response = await transport(url,{ headers,method,signal:options.signal });
    const location = response.headers.get("location");
    if (!redirects.has(response.status) || redirect === "manual" || (!location && redirect === "follow")) return response;
    await response.body?.cancel();
    if (redirect === "error" || hops >= 19) throw new Error("Redirección no permitida.");
    const next = publicTarget(new URL(location,url));
    if (next.origin !== url.origin) {
      for (const header of ["authorization","cookie","proxy-authorization","client-id"]) headers.delete(header);
    }
    url = next;
  }
}

module.exports = { publicTarget, publicLookup, publicRequest };
