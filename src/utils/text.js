export function normalizeText(value) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toAbsoluteUrl(path, baseUrl) {
  try {
    return new URL(path, baseUrl).href;
  } catch {
    return path;
  }
}

export function slugifyKey(value, fallback) {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return slug || fallback;
}
