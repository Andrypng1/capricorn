import { describe, expect, it } from "vitest";
import { agendaDayOffset, agendaGroups } from "./agenda-domain";
import { matches, safeUrl } from "./domain";

describe("búsqueda", () => {
  it("encuentra palabras sin tildes en campos distintos", () => {
    expect(matches("edicion lopez", "Edición", "López")).toBe(true);
    expect(matches("edición sin", "Edición", "López")).toBe(false);
  });
});

describe("URL", () => {
  it("permite HTTP(S) y rechaza protocolos locales y credenciales", () => {
    expect(safeUrl(" https://example.com ")).toBe(true);
    expect(safeUrl("file:///C:/archivo")).toBe(false);
    expect(safeUrl("https://usuario:clave@example.com")).toBe(false);
  });
});
describe("Agenda", () => {
  const project = (due_date:string, status = "editing") => ({ due_date,status });
  it("separa atrasados, hoy y el resto de la semana en orden ascendente", () => {
    const groups = agendaGroups([
      project("2026-11-22"), project("2026-11-19"), project("2026-11-20"), project("2026-11-18"),
      project("2026-11-21"), project("2026-11-23"), project("2026-11-20","delivered"), project("2026-11-19","archived"),
    ], [], new Date(2026,10,20), 3);
    expect(groups.overdue.map(({ date }) => date)).toEqual(["2026-11-18","2026-11-19"]);
    expect(groups.today.map(({ date }) => date)).toEqual(["2026-11-20"]);
    expect(groups.week.map(({ date }) => date)).toEqual(["2026-11-21","2026-11-22"]);
  });

  it("incluye el domingo si hoy es sábado y separa el lunes al llegar al domingo", () => {
    const projects = [project("2026-11-22"),project("2026-11-23")];
    expect(agendaGroups(projects,[],new Date(2026,10,21),2).week.map(({ date }) => date)).toEqual(["2026-11-22"]);
    expect(agendaGroups(projects,[],new Date(2026,10,22),2).week).toEqual([]);
  });

  it("atraviesa el cambio de mes al ordenar material pendiente y calcular días relativos", () => {
    const material = (expires_at:string, download_status = "pending", kind = "material") => ({ expires_at,download_status,kind });
    const groups = agendaGroups([project("2026-11-01")],[
      material("2026-11-02"), material("2026-10-30"), material("2026-11-01"),
      material("2026-10-31","downloaded"), material("2026-10-31","pending","delivery"), material("2026-11-03"),
    ],new Date(2026,9,30),3);
    expect(groups.week.map(({ date }) => date)).toEqual(["2026-11-01"]);
    expect(groups.materials.map(({ date }) => date)).toEqual(["2026-10-30","2026-11-01","2026-11-02"]);
    expect(agendaDayOffset("2026-11-01","2026-10-30")).toBe(2);
  });
});
