import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { publicTarget, publicLookup, publicRequest } = require("../desktop/public-network.cjs");
const { webUrl } = require("../desktop/store.cjs");

describe("URL guardada", () => {
  it("admite HTTP(S) y conserva enlaces privados para abrirlos manualmente", () => {
    expect(webUrl(" https://example.com/material ").href).toBe("https://example.com/material");
    expect(webUrl("http://192.168.0.1/").hostname).toBe("192.168.0.1");
  });

  it.each(["file:///C:/archivo","javascript:alert(1)","https://usuario:clave@example.com","sin-protocolo"])(
    "rechaza %s", (input) => expect(() => webUrl(input)).toThrow(),
  );
});

describe("destinos públicos HTTP", () => {
  it.each(["https://example.com/","http://8.8.8.8/","https://[2606:4700::1111]/"])(
    "admite %s", (input) => expect(publicTarget(input).href).toBe(input),
  );
  it.each(["localhost","test.local","127.0.0.7","10.1.2.3","172.31.2.3","192.168.2.3","169.254.1.1",
    "[::1]","[fc00::1]","[fe80::1]","[::ffff:127.0.0.1]"])(
    "rechaza el destino privado %s", (host) => expect(() => publicTarget("http://" + host)).toThrow(),
  );

  function resolveAddresses(addresses:{ address:string; family:number }[]) {
    return new Promise((resolve,reject) => {
      publicLookup(async () => addresses)("example.com",{ all:true },(error:Error|null, result:unknown) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }

  it("pasa a la conexión las direcciones públicas que verificó", async () => {
    const addresses = [{ address:"8.8.8.8",family:4 },{ address:"2606:4700::1111",family:6 }];
    await expect(resolveAddresses(addresses)).resolves.toEqual(addresses);
  });
  it("bloquea respuestas mixtas de DNS", async () => {
    await expect(resolveAddresses([{ address:"8.8.8.8",family:4 },{ address:"10.0.0.2",family:4 }])).rejects.toThrow("DNS");
  });
  it("valida otra vez antes de seguir una redirección", async () => {
    const requested:string[] = [];
    const transport = async (url:URL) => {
      requested.push(url.href);
      return { status:302, headers:new Headers({ location:"http://localhost/" }),body:null };
    };
    await expect(publicRequest("https://example.com/",{},transport)).rejects.toThrow("destino público");
    expect(requested).toEqual(["https://example.com/"]);
  });
});
