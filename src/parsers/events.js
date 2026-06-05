import { normalizeText } from "../utils/text.js";

export const divhistKeyMap = {
  "игрок_с_мячом": "player_with_ball",
  "команда": "team",
  "минута": "time",
  "итерация": "step",
  "itreation": "step",
  "iteration": "step",
  "действие": "action",
  "принимающий": "target",
  "коорд": "position",
  "результат": "result",
  "соперник": "opponent",
  "mixed_action": "mixed_action",
  "prev_pm": "prev_pm",
  "prev_pass": "prev_pass"
};

export function parsePositionValue(raw) {
  const value = normalizeText(raw);
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value.replace(/\(/g, "[").replace(/\)/g, "]"));
    if (Array.isArray(parsed)) {
      return parsed.filter(Array.isArray).map((pair) => pair.map((item) => Number(item)));
    }
  } catch {
  }

  const matches = [...value.matchAll(/\[(\d+)\s*,\s*(\d+)\]/g)];
  return matches.map((match) => [Number(match[1]), Number(match[2])]);
}

export function parsePrevPassValue(raw) {
  const value = normalizeText(raw);
  if (!value) {
    return { pm: "", coords: [] };
  }

  const pmMatch = value.match(/['"]?pm['"]?\s*:\s*(\d+)/);
  const coordMatch = value.match(/['"]?coord['"]?\s*:\s*(\[\s*\[[^\]]+\]\s*,\s*\[[^\]]+\]\s*\])/);
  return {
    pm: pmMatch ? pmMatch[1] : "",
    coords: coordMatch ? parsePositionValue(coordMatch[1]) : []
  };
}

export function coerceValue(key, raw) {
  const value = normalizeText(raw);
  if (!value) {
    return "";
  }

  if (key === "time" || key === "step") {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }

  if (key === "position") {
    return parsePositionValue(value);
  }

  if (key === "result") {
    if (value === "True") return true;
    if (value === "False") return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return Number(value);
    }
  }

  return value;
}
