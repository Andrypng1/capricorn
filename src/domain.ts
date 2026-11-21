export function matches(query: string, ...fields: (string | null | undefined)[]) {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
  return normalize(query.trim()).split(/\s+/).every((word) => fields.some((field) => normalize(field ?? "").includes(word)));
}

export function safeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}