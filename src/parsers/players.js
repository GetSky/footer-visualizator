import { normalizeText } from "../utils/text.js";

export function parsePlayerValue(raw) {
  const value = normalizeText(raw);
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return { id: null, name: value, label: value };
  }

  return {
    id: match[1],
    name: match[2],
    label: value
  };
}

export function parsePlayerIdReference(raw) {
  const value = normalizeText(raw);
  if (!value || value === "None") {
    return "";
  }

  const match = value.match(/\d+/);
  return match ? match[0] : "";
}

export function parseNamedIdReference(raw, key) {
  const value = normalizeText(raw);
  if (!value) {
    return "";
  }

  const match = value.match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
  return match ? match[1] : "";
}
