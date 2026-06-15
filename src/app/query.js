export function normalizeMatchQueryValue(value) {
  const trimmedValue = String(value || "").trim();
  if (/^\d+$/.test(trimmedValue)) {
    return `https://footter.com/match/${trimmedValue}/`;
  }
  return trimmedValue;
}

export function getMatchUrlFromQuery(search = "") {
  const params = new URLSearchParams(search);
  const queryValue = params.get("url") || params.get("match_url") || params.get("match");
  return queryValue ? normalizeMatchQueryValue(queryValue) : "";
}
