export function calendarDate(date:Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2,"0")).join("-");
}

function plusDays(date:Date, days:number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return calendarDate(result);
}

export function agendaGroups<T extends { status:string; due_date?:string | null },
  L extends { kind:string; download_status:string; expires_at?:string | null }>(
  projects:readonly T[], links:readonly L[], now:Date, warningDays:number,
) {
  const today = calendarDate(now);
  const sunday = plusDays(now,(7 - now.getDay()) % 7);
  const cutoff = plusDays(now,warningDays);
  const pending = projects.flatMap((project) => project.due_date && project.status !== "delivered" && project.status !== "archived"
    ? [{ item:project, date:project.due_date }] : []).sort((a,b) => a.date.localeCompare(b.date));
  const materials = links.flatMap((link) => link.kind === "material" && link.download_status === "pending" &&
    link.expires_at && link.expires_at >= today && link.expires_at <= cutoff ? [{ item:link, date:link.expires_at }] : [])
    .sort((a,b) => a.date.localeCompare(b.date));
  return {
    overdue:pending.filter(({ date }) => date < today),
    today:pending.filter(({ date }) => date === today),
    week:pending.filter(({ date }) => date > today && date <= sunday),
    materials,
  };
}

export function agendaDayOffset(date:string, today:string) {
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
}
