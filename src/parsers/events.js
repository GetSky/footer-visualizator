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
    return { pm: "", pe: "", pr: "", coords: [] };
  }

  const getRawEntry = (keys) => {
    const keyPattern = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const match = value.match(new RegExp(`['"]?(?:${keyPattern})['"]?\\s*(?:,|:)\\s*([^,\\]}\\)]+)`));
    return match ? normalizeText(match[1].replace(/^['"]|['"]$/g, "")) : "";
  };

  const getNumericEntry = (keys) => {
    const rawValue = getRawEntry(keys);
    const match = rawValue.match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : "";
  };

  const getIdEntry = (keys) => {
    const rawValue = getRawEntry(keys);
    const match = rawValue.match(/\d+/);
    return match ? match[0] : "";
  };

  const getQuotedEntry = (keys) => {
    const keyPattern = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const match = value.match(new RegExp(`['"]?(?:${keyPattern})['"]?\\s*(?:,|:)\\s*(['"])(.*?)\\1`));
    return match ? normalizeText(match[2]) : getRawEntry(keys);
  };

  const coordMatch = value.match(/['"]?(?:coord|\u043A\u043E\u043E\u0440\u0434)['"]?\s*(?:,|:)\s*(\[\s*\[[^\]]+\]\s*,\s*\[[^\]]+\]\s*\])/);

  return {
    action: getQuotedEntry(["action", "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435"]),
    time: getNumericEntry(["minute", "\u043C\u0438\u043D\u0443\u0442\u0430"]),
    step: getNumericEntry(["iteration", "itreation", "\u0438\u0442\u0435\u0440\u0430\u0446\u0438\u044F"]),
    teamIndex: getNumericEntry(["team"]),
    team: getQuotedEntry(["\u043A\u043E\u043C\u0430\u043D\u0434\u0430"]),
    pm: getIdEntry(["pm"]),
    pe: getIdEntry(["pe"]),
    pr: getIdEntry(["pr"]),
    player_with_ball: getQuotedEntry(["\u0438\u0433\u0440\u043E\u043A \u0441 \u043C\u044F\u0447\u043E\u043C"]),
    opponent: getQuotedEntry(["\u0441\u043E\u043F\u0435\u0440\u043D\u0438\u043A"]),
    target: getQuotedEntry(["\u043F\u0440\u0438\u043D\u0438\u043C\u0430\u044E\u0449\u0438\u0439"]),
    result: getNumericEntry(["well", "\u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442"]),
    cue1: getQuotedEntry(["cue1"]),
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
