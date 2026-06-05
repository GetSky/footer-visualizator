import {
  FIELD_COLS,
  FIELD_ROWS,
  FOOTTER_PROXY_MATCH_URL,
  KICKOFF_POINT,
  START_COORD_FALLBACK,
  TEAM_COLORS
} from "./constants.js";
import { coerceValue, divhistKeyMap, parsePrevPassValue } from "./parsers/events.js";
import { parseNamedIdReference, parsePlayerIdReference, parsePlayerValue } from "./parsers/players.js";
import { normalizeText, slugifyKey, toAbsoluteUrl } from "./utils/text.js";

const urlInput = document.getElementById("urlInput");
const loadButton = document.getElementById("loadButton");
const localSourceGrid = document.getElementById("localSourceGrid");
const pageFileInput = document.getElementById("pageFileInput");
const playButton = document.getElementById("playButton");
const prevButton = document.getElementById("prevButton");
const nextButton = document.getElementById("nextButton");
const speedSelect = document.getElementById("speedSelect");
const timelineRange = document.getElementById("timelineRange");
const timelineLabel = document.getElementById("timelineLabel");
const episodeInfoButton = document.getElementById("episodeInfoButton");
const episodeModalBackdrop = document.getElementById("episodeModalBackdrop");
const episodeModalClose = document.getElementById("episodeModalClose");
const eventListModalBackdrop = document.getElementById("eventListModalBackdrop");
const eventListModalClose = document.getElementById("eventListModalClose");
const teamsLabel = document.getElementById("teamsLabel");
const matchMinute = document.getElementById("matchMinute");
const fieldPanel = document.querySelector(".field-panel");
const fieldApron = document.querySelector(".field-apron");
const field = document.getElementById("field");
const currentLogCard = document.getElementById("currentLogCard");
const currentLogText = document.getElementById("currentLogText");
const trailLayer = document.getElementById("trailLayer");
const markerLayer = document.getElementById("markerLayer");
const eventList = document.getElementById("eventList");
const eventClock = document.getElementById("eventClock");
const eventAction = document.getElementById("eventAction");
const eventResult = document.getElementById("eventResult");
const eventTeam = document.getElementById("eventTeam");
const eventBallPlayer = document.getElementById("eventBallPlayer");
const eventTarget = document.getElementById("eventTarget");
const eventOpponent = document.getElementById("eventOpponent");
const eventCoords = document.getElementById("eventCoords");
const statusNode = document.getElementById("status");
const progressNode = document.getElementById("progress");
const progressDetailNode = document.getElementById("progressDetail");
const progressFillNode = document.getElementById("progressFill");
const progressStepsNode = document.getElementById("progressSteps");

const state = {
  events: [],
  text: "",
  teams: [],
  score: [0, 0],
  teamByPlayerId: {},
  playerById: {},
  playerPositionById: {},
  snapshots: [],
  currentIndex: 0,
  timer: null,
  markerNodes: {}
};

let fieldResizeObserver = null;
let progressSteps = [];
let episodeModalPreviouslyFocused = null;
let eventListModalPreviouslyFocused = null;

function setStatus(message, isError) {
  statusNode.textContent = message;
  statusNode.className = isError ? "status error" : "status";
}

function renderProgressSteps() {
  progressStepsNode.innerHTML = "";
  progressSteps.forEach((step) => {
    const item = document.createElement("div");
    item.className = `progress-step ${step.state}`;

    const textWrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = step.title;
    const description = document.createElement("small");
    description.textContent = step.description;

    textWrap.append(title, description);
    item.append(textWrap);
    progressStepsNode.append(item);
  });
}

function createProgressFlow(stepDefinitions) {
  progressSteps = stepDefinitions.map((step) => ({
    key: step.key,
    title: step.title,
    description: step.description,
    state: "pending"
  }));

  progressNode.classList.add("visible");
  progressDetailNode.textContent = "Подготавливаю загрузку...";
  progressFillNode.style.width = "0%";
  renderProgressSteps();
}

function updateProgress(stepKey, detail, status) {
  const currentIndex = progressSteps.findIndex((step) => step.key === stepKey);
  if (currentIndex === -1) {
    if (detail) {
      progressDetailNode.textContent = detail;
    }
    return;
  }

  progressSteps = progressSteps.map((step, index) => {
    if (step.state === "error" && index !== currentIndex) {
      return step;
    }
    if (index < currentIndex && step.state !== "error") {
      return { ...step, state: "done" };
    }
    if (index === currentIndex) {
      return { ...step, state: status || "active" };
    }
    return { ...step, state: "pending" };
  });

  const completedSteps = progressSteps.filter((step) => step.state === "done").length;
  const activeStep = progressSteps[currentIndex];
  const progressValue = ((completedSteps + (activeStep && activeStep.state === "active" ? 0.5 : 1)) / Math.max(progressSteps.length, 1)) * 100;

  progressDetailNode.textContent = detail || "";
  progressFillNode.style.width = `${Math.max(4, Math.min(progressValue, 100))}%`;
  renderProgressSteps();
}

function completeProgress(detail) {
  progressSteps = progressSteps.map((step) => ({ ...step, state: "done" }));
  progressDetailNode.textContent = detail;
  progressFillNode.style.width = "100%";
  renderProgressSteps();
}

function failProgress(stepKey, detail) {
  updateProgress(stepKey, detail, "error");
}

function splitDivhistLines(element) {
  const rows = [];
  let current = [];

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === "br") {
      rows.push(normalizeText(current.join(" ")));
      current = [];
      continue;
    }

    const text = normalizeText(node.textContent || "");
    if (text) {
      current.push(text);
    }
  }

  const tail = normalizeText(current.join(" "));
  if (tail) {
    rows.push(tail);
  }

  return rows.filter(Boolean);
}

function divhistToEvent(element, index) {
  const event = {
    index,
    raw_text: normalizeText(element.textContent)
  };

  splitDivhistLines(element).forEach((line, lineIndex) => {
    const match = line.match(/^\s*([^:—]+?)\s*[:—]\s*(.+)\s*$/);
    if (!match) {
      event[`line_${lineIndex + 1}`] = line;
      return;
    }

    const rawKey = normalizeText(match[1]);
    const rawValue = normalizeText(match[2]);
    let key = slugifyKey(rawKey, `line_${lineIndex + 1}`);
    key = divhistKeyMap[key] || key;

    if (Object.prototype.hasOwnProperty.call(event, key)) {
      key = `${key}_${lineIndex + 1}`;
    }

    event[key] = coerceValue(key, rawValue);
  });

  return event;
}


function extractMatchLogUrl(doc, pageUrl) {
  const fullLog = doc.querySelector("#full_log");
  if (fullLog && normalizeText(fullLog.textContent)) {
    return pageUrl;
  }

  const scriptText = Array.from(doc.scripts).map((script) => script.textContent || "").join("\n");
  const fromScript = scriptText.match(/['"](?<path>\/match_log\/\d+\/?)['"]/i);
  if (fromScript && fromScript.groups && fromScript.groups.path) {
    return toAbsoluteUrl(fromScript.groups.path, pageUrl);
  }

  const fromMatchUrl = pageUrl.match(/\/match\/(\d+)\/?/i);
  if (fromMatchUrl) {
    return toAbsoluteUrl(`/match_log/${fromMatchUrl[1]}/`, pageUrl);
  }

  const directMatchLog = pageUrl.match(/\/match_log\/\d+\/?/i);
  return directMatchLog ? pageUrl : null;
}

async function fetchText(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchWithFallbacks(url) {
  const candidates = [
    { label: "getsky-proxy", url: `${FOOTTER_PROXY_MATCH_URL}?url=${encodeURIComponent(url)}`, reader: "text" },
    { label: "direct", url, reader: "text" },
    { label: "allorigins-json", url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, reader: "allorigins" },
    { label: "allorigins-raw", url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, reader: "text" },
    { label: "corsproxy", url: `https://corsproxy.io/?url=${encodeURIComponent(url)}`, reader: "text" }
  ];

  const errors = [];
  for (const candidate of candidates) {
    try {
      const text = await fetchCandidateText(candidate);
      return { text, resolvedVia: candidate.label };
    } catch (error) {
      errors.push(`${candidate.label}: ${error.message}`);
    }
  }

  throw new Error(`Не удалось загрузить страницу. ${errors.join(" | ")}`);
}

async function fetchCandidateText(candidate) {
  const response = await fetch(candidate.url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (candidate.reader === "allorigins") {
    const payload = await response.json();
    if (!payload || typeof payload.contents !== "string" || !payload.contents.trim()) {
      throw new Error("Empty response body");
    }
    return payload.contents;
  }

  return response.text();
}

function buildHostedRemoteFetchMessage(errorMessage) {
  const isFileProtocol = window.location.protocol === "file:";
  const isHostedApp = !isFileProtocol && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname || "");
  const hint = isFileProtocol
    ? "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043e\u0442\u043a\u0440\u044b\u0442\u0430 \u043a\u0430\u043a file://, \u0438 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u0431\u043b\u043e\u043a\u0438\u0440\u0443\u0435\u0442 \u043f\u0440\u044f\u043c\u043e\u0439 fetch \u043d\u0430 footter."
    : (isHostedApp
      ? "\u041d\u0430 \u0434\u043e\u043c\u0435\u043d\u0435 direct-fetch \u0443\u043f\u0438\u0440\u0430\u0435\u0442\u0441\u044f \u0432 CORS. \u0412 \u044d\u0442\u043e\u043c \u0440\u0435\u0436\u0438\u043c\u0435 \u043e\u0441\u043d\u043e\u0432\u043d\u0430\u044f \u043d\u0430\u0434\u0435\u0436\u0434\u0430 \u2014 `getsky.tech/footter_proxy_match`, \u0430 \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0435 CORS-\u043f\u0440\u043e\u043a\u0441\u0438 \u0438\u0434\u0443\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u043a\u0430\u043a fallback."
      : "\u041f\u0440\u044f\u043c\u043e\u0439 fetch \u043d\u0430 footter \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d CORS-\u043f\u043e\u043b\u0438\u0442\u0438\u043a\u043e\u0439 \u0438\u043b\u0438 \u043f\u0440\u043e\u043a\u0441\u0438 \u043d\u0435 \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d.");
  return `\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435. ${hint} \u0421\u0430\u043c\u044b\u0439 \u043d\u0430\u0434\u0451\u0436\u043d\u044b\u0439 \u0432\u0430\u0440\u0438\u0430\u043d\u0442: \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0439 HTML \u043c\u0430\u0442\u0447\u0430 \u0438\u043b\u0438 match_log. ${errorMessage}`;
}

function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

async function readFileText(file) {
  if (!file) {
    return "";
  }
  return file.text();
}

function renderFullLog(fullLog) {
  const divhistNodes = Array.from(fullLog.querySelectorAll(".divhist, div[id*='divhist'], div[class*='divhist']"));
  const events = divhistNodes.map(divhistToEvent);
  const text = normalizeText(fullLog.textContent);
  return { events, text };
}

function getLocalSourceLabel(file) {
  return file ? `Локальный файл: ${file.name}` : "-";
}

function getInitialSourceLabel(pageUrl, pageFile) {
  if (pageUrl) {
    return pageUrl;
  }
  if (pageFile) {
    return getLocalSourceLabel(pageFile);
  }
  return "-";
}

function getUniqueTeams(events) {
  return Array.from(new Set(events.map((event) => normalizeText(event.team)).filter(Boolean))).slice(0, 2);
}

function isFootballPosition(value) {
  return /^(GK|LD|CD|RD|LWB|DM|RWB|LM|CM|RM|LW|AM|RW|CF)$/i.test(normalizeText(value));
}

function normalizePlayerNameKey(value) {
  return normalizeText(value).toLowerCase();
}

function extractPositionByPlayerName(doc) {
  const map = {};
  if (!doc) {
    return map;
  }

  Array.from(doc.querySelectorAll("table.players tr, #player-stat_div table tr")).forEach((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => normalizeText(cell.textContent));
    if (cells.length < 3) {
      return;
    }

    let position = "";
    let playerName = "";

    if (isFootballPosition(cells[0])) {
      position = cells[0];
      playerName = cells[1];
    } else if (isFootballPosition(cells[2])) {
      position = cells[2];
      playerName = cells[1];
    }

    const key = normalizePlayerNameKey(playerName);
    if (key && position) {
      map[key] = position.toUpperCase();
    }
  });

  return map;
}

function collectEventPlayers(event) {
  return [
    parsePlayerValue(event.player_with_ball),
    parsePlayerValue(event.target),
    parsePlayerValue(event.opponent)
  ].filter(Boolean);
}

function buildPlayerInfoById(events) {
  const map = {};

  events.forEach((event) => {
    collectEventPlayers(event).forEach((player) => {
      if (player.id && !map[player.id]) {
        map[player.id] = player;
      }
    });
  });

  return map;
}

function buildPlayerPositionById(events, positionByPlayerName) {
  const map = {};

  events.forEach((event) => {
    collectEventPlayers(event).forEach((player) => {
      if (!player.id || map[player.id]) {
        return;
      }

      const position = positionByPlayerName[normalizePlayerNameKey(player.name)];
      if (position) {
        map[player.id] = position;
      }
    });
  });

  return map;
}

function extractTeamsFromMatchDoc(doc, events) {
  if (!doc) {
    return getUniqueTeams(events);
  }

  const leftNode = doc.querySelector("#team_left");
  const rightNode = doc.querySelector("#team_rigth, #team_right");
  const leftText = normalizeText(leftNode ? leftNode.textContent : "");
  const rightText = normalizeText(rightNode ? rightNode.textContent : "");

  if (leftText && rightText) {
    return [leftText, rightText];
  }

  const scriptText = Array.from(doc.scripts).map((script) => script.textContent || "").join("\n");
  const leftMatch = scriptText.match(/\$\("#team_left"\)\.html\("([^"]+)"\)/);
  const rightMatch = scriptText.match(/\$\("#team_rigth"\)\.html\("([^"]+)"\)|\$\("#team_right"\)\.html\("([^"]+)"\)/);
  const leftFromScript = normalizeText(leftMatch ? leftMatch[1] : "");
  const rightFromScript = normalizeText(rightMatch ? (rightMatch[1] || rightMatch[2] || "") : "");

  if (leftFromScript && rightFromScript) {
    return [leftFromScript, rightFromScript];
  }

  return getUniqueTeams(events);
}

function inferTeamByPlayer(events, teams) {
  const map = {};

  function assign(player, team) {
    if (!player || !player.id || !team || map[player.id]) {
      return;
    }
    map[player.id] = team;
  }

  function otherTeam(team) {
    return teams.find((item) => item !== team) || team;
  }

  events.forEach((event) => {
    const actor = parsePlayerValue(event.player_with_ball);
    const target = parsePlayerValue(event.target);
    const opponent = parsePlayerValue(event.opponent);
    const team = normalizeText(event.team);

    assign(actor, team);
    assign(target, team);
    assign(opponent, otherTeam(team));
  });

  return map;
}

function normalizeActionLabel(action) {
  const map = {
    "short_pass": "Короткий пас",
    "medium_pass": "Средний пас",
    "long_pass": "Длинный пас",
    "naves": "Навес",
    "corner_pass": "Угловой",
    "dribling": "Дриблинг",
    "pass": "Пас",
    "удар": "Удар",
    "пенальти": "Пенальти",
    "medium_shot": "Средний удар",
    "long_shot": "Дальний удар",
    "нарушение": "Нарушение",
    "розыгрыш": "Розыгрыш"
  };
  return map[action] || action || "Эпизод";
}

function getResultLabel(value) {
  if (value === true) return "Успех";
  if (value === false) return "Провал";
  if (value === "" || value === undefined) return "-";
  return String(value);
}

function makeDisplayName(player) {
  return player ? player.name : "-";
}

function clampCoord(row, col) {
  const rawRow = Number(row);
  const rawCol = Number(col);
  const safeRow = Math.max(1, Math.min(FIELD_ROWS, Number.isFinite(rawRow) ? rawRow : START_COORD_FALLBACK[0]));
  const safeCol = Math.max(1, Math.min(FIELD_COLS, Number.isFinite(rawCol) ? rawCol : START_COORD_FALLBACK[1]));
  return [safeRow, safeCol];
}

function getCoordsPair(event) {
  const coords = Array.isArray(event.position) ? event.position : [];
  if (coords.length >= 2) {
    return {
      from: clampCoord(coords[0][0], coords[0][1]),
      to: clampCoord(coords[1][0], coords[1][1])
    };
  }

  if (coords.length === 1) {
    const point = clampCoord(coords[0][0], coords[0][1]);
    return { from: point, to: point };
  }

  return { from: null, to: null };
}

function getEventPoint(event) {
  const coords = Array.isArray(event.position) ? event.position : [];
  if (coords.length === 0) {
    return null;
  }

  return clampCoord(coords[0][0], coords[0][1]);
}

function toGlobalCoord(coord, teamName, teams) {
  if (!coord) {
    return null;
  }

  return clampCoord(coord[0], coord[1]);
}

function getPlayerMarkerLabel(player) {
  if (player && player.id && state.playerPositionById[player.id]) {
    return state.playerPositionById[player.id];
  }

  const name = player && player.name ? player.name : "";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").slice(0, 2).toUpperCase() || "P";
}

function makePlayerState(player, team, row, col, role, index, fallbackColor) {
  return {
    id: player ? player.id : `${role}_${index}`,
    name: player ? player.name : role,
    markerLabel: getPlayerMarkerLabel(player),
    team: team || fallbackColor,
    row,
    col,
    role,
    active: true
  };
}

function getPenaltySpot(teamName, teams) {
  const teamIndex = teams.indexOf(normalizeText(teamName));
  return teamIndex === 1 ? [2, 2.5] : [13, 2.5];
}

function clonePlayersById(playersById) {
  const clone = {};
  Object.keys(playersById).forEach((playerId) => {
    clone[playerId] = { ...playersById[playerId] };
  });
  return clone;
}

function buildSnapshots(events, teams, teamByPlayerId) {
  const snapshots = [];
  const knownPlayersById = {};

  const defaultTeams = {
    home: teams[0] || "Команда 1",
    away: teams[1] || "Команда 2"
  };

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const actor = parsePlayerValue(event.player_with_ball);
    const target = parsePlayerValue(event.target);
    const opponent = parsePlayerValue(event.opponent);
    const framePlayers = {};
    const team = normalizeText(event.team);
    const actorTeam = actor && actor.id && teamByPlayerId[actor.id] ? teamByPlayerId[actor.id] : team;
    const action = String(event.action || "").toLowerCase();
    const isKickoff = action === "розыгрыш";
    const isPenalty = action === "пенальти";
    const localPoint = getEventPoint(event);
    const nextEvent = events[index + 1] || null;
    const nextLocalPoint = nextEvent ? getEventPoint(nextEvent) : null;
    const previousFocusPoint = snapshots.length ? snapshots[snapshots.length - 1].focusPoint : null;
    const kickoffPoint = toGlobalCoord(nextLocalPoint, team, teams);
    const coordsPair = getCoordsPair(event);
    let currentPoint = isKickoff
      ? (kickoffPoint || KICKOFF_POINT)
      : (
        isPenalty
          ? getPenaltySpot(team, teams)
          : (toGlobalCoord(localPoint, team, teams) || START_COORD_FALLBACK)
      );

    if (isCornerKickNavesEvent(event)) {
      currentPoint = getCornerKickPasserPoint({ event }, coordsPair.to || localPoint || currentPoint);
    } else if (isCornerPassEvent(event) && !localPoint) {
      currentPoint = getCornerKickPasserPoint({ event }, previousFocusPoint || currentPoint);
    }
    const previousPlayersById = clonePlayersById(knownPlayersById);

    if (actor) {
      const actorState = makePlayerState(actor, actorTeam, currentPoint[0], currentPoint[1], "ball", event.index, defaultTeams.home);
      if (isCornerKickNavesEvent(event)) {
        actorState.isCornerPasser = true;
      }
      framePlayers[actor.id || `actor_${event.index}`] = actorState;
      if (actor.id) {
        knownPlayersById[actor.id] = actorState;
      }
    }

    if (target && target.id && coordsPair.to && isPassAction(action)) {
      const targetTeam = teamByPlayerId[target.id] || team;
      const targetPoint = isCornerKickNavesEvent(event) && nextLocalPoint
        ? nextLocalPoint
        : (isCornerKickNavesEvent(event) && coordsPair.from ? coordsPair.from : coordsPair.to);
      knownPlayersById[target.id] = makePlayerState(target, targetTeam, targetPoint[0], targetPoint[1], "target", event.index, targetTeam);
    }

    if (opponent && opponent.id && isCornerKickNavesEvent(event) && nextLocalPoint) {
      const opponentTeam = teamByPlayerId[opponent.id] || getOtherTeam(team);
      knownPlayersById[opponent.id] = makePlayerState(opponent, opponentTeam, nextLocalPoint[0], nextLocalPoint[1], "opponent", event.index, opponentTeam);
    }

    if (target && target.id && isCornerPassEvent(event) && isNavesShotEvent(nextEvent)) {
      const targetTeam = teamByPlayerId[target.id] || team;
      const targetPoint = getCornerReceptionPoint(currentPoint) || currentPoint;
      knownPlayersById[target.id] = makePlayerState(target, targetTeam, targetPoint[0], targetPoint[1], "target", event.index, targetTeam);
    }

    if (opponent && opponent.id && coordsPair.to && isFailedPassResult(event.result)) {
      const opponentTeam = teamByPlayerId[opponent.id] || getOtherTeam(team);
      knownPlayersById[opponent.id] = makePlayerState(opponent, opponentTeam, coordsPair.to[0], coordsPair.to[1], "opponent", event.index, opponentTeam);
    }

    snapshots.push({
      event,
      players: framePlayers,
      playersById: clonePlayersById(knownPlayersById),
      previousPlayersById,
      focusPoint: currentPoint
    });
  }

  return snapshots;
}

function getTeamSide(teamName) {
  const index = state.teams.indexOf(teamName);
  return TEAM_COLORS[index] || "home";
}

function formatTeamName(teamName) {
  const side = getTeamSide(teamName);
  const className = side === "away" ? "team-away" : "team-home";
  return `<span class="${className}">${teamName || "-"}</span>`;
}

function coordToPercent(row, col, options = {}) {
  const [baseRow, baseCol] = clampCoord(row, col);
  const rawRow = Number(row);
  const rawCol = Number(col);
  const safeRow = options.allowOuterRows && Number.isFinite(rawRow)
    ? Math.max(0.5, Math.min(FIELD_ROWS + 0.5, rawRow))
    : baseRow;
  const safeCol = options.allowOuterCols && Number.isFinite(rawCol)
    ? Math.max(0.5, Math.min(FIELD_COLS + 0.5, rawCol))
    : baseCol;
  return {
    x: ((safeRow - 0.5) / FIELD_ROWS) * 100,
    y: ((safeCol - 0.5) / FIELD_COLS) * 100
  };
}

function createFieldLabels() {
  Array.from(field.querySelectorAll(".cell-label")).forEach((node) => node.remove());

  for (let row = 1; row <= FIELD_ROWS; row++) {
    const label = document.createElement("div");
    label.className = "cell-label";
    const pos = coordToPercent(row, 1);
    label.textContent = String(row);
    label.style.left = `${pos.x}%`;
    label.style.bottom = "10px";
    label.style.transform = "translateX(-50%)";
    field.appendChild(label);
  }

  for (let col = 1; col <= FIELD_COLS; col++) {
    const label = document.createElement("div");
    label.className = "cell-label";
    const pos = coordToPercent(1, col);
    label.textContent = String(col);
    label.style.left = "12px";
    label.style.top = `${pos.y}%`;
    label.style.transform = "translateY(-50%)";
    field.appendChild(label);
  }
}

function resizeField() {
  if (!fieldPanel || !field) {
    return;
  }

  const panelRect = fieldPanel.getBoundingClientRect();
  const apronRect = fieldApron ? fieldApron.getBoundingClientRect() : null;
  const apronStyle = fieldApron ? getComputedStyle(fieldApron) : null;
  const fieldStyle = getComputedStyle(field);
  const apronPaddingX = apronStyle
    ? parseFloat(apronStyle.paddingLeft) + parseFloat(apronStyle.paddingRight)
    : 0;
  const fieldBorderX = parseFloat(fieldStyle.borderLeftWidth) + parseFloat(fieldStyle.borderRightWidth);
  const fieldBorderY = parseFloat(fieldStyle.borderTopWidth) + parseFloat(fieldStyle.borderBottomWidth);
  const availableOuterWidth = apronRect && apronRect.width
    ? apronRect.width
    : Math.min(panelRect.width, 998);
  const availableWidth = Math.max(260, availableOuterWidth - apronPaddingX);
  const nextContentWidth = Math.max(FIELD_ROWS * 18, Math.floor((availableWidth - fieldBorderX) / FIELD_ROWS) * FIELD_ROWS);
  const nextWidth = nextContentWidth + fieldBorderX;
  const nextContentHeight = nextContentWidth * (FIELD_COLS / (FIELD_ROWS / 2));
  const nextHeight = nextContentHeight + fieldBorderY;

  field.style.width = `${nextWidth}px`;
  field.style.height = `${nextHeight}px`;
}

function refreshFieldLayout() {
  resizeField();
  createFieldLabels();
}

function scheduleFieldLayoutRefresh() {
  requestAnimationFrame(() => {
    refreshFieldLayout();
    requestAnimationFrame(() => {
      refreshFieldLayout();
    });
  });
}

function isPassAction(action) {
  return action === "pass"
    || action === "short_pass"
    || action === "medium_pass"
    || action === "long_pass"
    || action === "naves"
    || action === "corner_pass"
    || action === "prostrel"
    || action === "пас"
    || action === "короткий пас"
    || action === "средний пас"
    || action === "длинный пас"
    || action === "навес"
    || action === "угловой"
    || action === "прострел";
}

function isShotAction(action) {
  return action === "удар"
    || action === "пенальти"
    || action === "medium_shot"
    || action === "long_shot"
    || action === "средний удар"
    || action === "дальний удар";
}

function isSubstitutionAction(action) {
  return action === "замена";
}

function isDribbleAction(action) {
  return action === "dribling"
    || action === "дриблинг";
}

function isFoulAction(action) {
  return action === "нарушение"
    || action === "foul"
    || action === "violation";
}

function getSnapshotAction(snapshot) {
  return String((snapshot && snapshot.event && snapshot.event.action) || "").toLowerCase();
}

function isZeroLikeResult(result) {
  return result === 0
    || result === false
    || result === "0";
}

function isFailedPassResult(result) {
  return isZeroLikeResult(result)
    || result === 7
    || result === "7";
}

function samePlayer(leftPlayer, rightPlayer) {
  if (!leftPlayer || !rightPlayer) {
    return false;
  }

  if (leftPlayer.id && rightPlayer.id) {
    return leftPlayer.id === rightPlayer.id;
  }

  return normalizeText(leftPlayer.name) === normalizeText(rightPlayer.name);
}

function getOtherTeam(teamName) {
  return state.teams.find((item) => item !== teamName) || teamName;
}

function isCornerKickNavesShotEvent(event) {
  return normalizeText(event && event.mixed_action).toLowerCase().includes("cornerkick_naves_shot");
}

function isCornerKickNavesEvent(event) {
  return normalizeText(event && event.mixed_action).toLowerCase() === "cornerkick_naves";
}

function isCornerPassEvent(event) {
  const action = String((event && event.action) || "").toLowerCase();
  return action === "corner_pass" || action === "угловой";
}

function isNavesShotEvent(event) {
  const mixedAction = normalizeText(event && event.mixed_action).toLowerCase();
  return mixedAction === "naves_shot";
}

function getShotGoalPoint(teamName) {
  const isAway = getTeamSide(normalizeText(teamName)) === "away";
  return [isAway ? 0.5 : FIELD_ROWS + 0.5, (FIELD_COLS + 1) / 2];
}

function getShotGoalkeeperMarker(snapshot) {
  if (!snapshot || !snapshot.event || !isShotAction(getSnapshotAction(snapshot))) {
    return null;
  }

  const shotTeam = normalizeText(snapshot.event.team);
  const goalkeeperTeam = getOtherTeam(shotTeam);
  const point = getShotGoalPoint(shotTeam);
  const goalkeeper = parsePlayerValue(snapshot.event.opponent) || {
    id: `goalkeeper:${goalkeeperTeam || "defense"}`,
    name: "Вратарь",
    label: "Вратарь"
  };

  return {
    ...makePlayerState(
      goalkeeper,
      goalkeeperTeam,
      point[0],
      point[1],
      "goalkeeper",
      snapshot.event.index,
      goalkeeperTeam
    ),
    markerLabel: getPlayerMarkerLabel(goalkeeper) || "GK",
    markerId: `goalkeeper:${snapshot.event.index}:${goalkeeper.id || goalkeeper.name}`,
    markerPhase: "overlay",
    isGoalkeeper: true
  };
}

function isNextShotGoalkeeperPlayer(currentSnapshot, nextSnapshot, player) {
  if (!currentSnapshot || !nextSnapshot || !isShotAction(getSnapshotAction(currentSnapshot))) {
    return false;
  }

  const goalkeeper = parsePlayerValue(currentSnapshot.event.opponent);
  const nextActor = parsePlayerValue(nextSnapshot.event.player_with_ball);
  if (!goalkeeper || !nextActor || !samePlayer(goalkeeper, nextActor)) {
    return false;
  }

  return samePlayer(goalkeeper, player);
}

function resolvePlayerById(playerId, snapshot) {
  const id = parsePlayerIdReference(playerId);
  if (!id) {
    return null;
  }

  const previousState = snapshot && snapshot.previousPlayersById ? snapshot.previousPlayersById[id] : null;
  const currentState = snapshot && snapshot.playersById ? snapshot.playersById[id] : null;
  const playerInfo = state.playerById[id];
  const playerState = previousState || currentState;
  if (playerState) {
    return {
      id,
      name: playerState.name,
      label: `${id} ${playerState.name}`
    };
  }

  if (playerInfo) {
    return playerInfo;
  }

  return {
    id,
    name: `ID ${id}`,
    label: id
  };
}

function getCornerKickPasserPoint(snapshot, sourcePoint = null) {
  const shotPoint = sourcePoint || (snapshot && snapshot.focusPoint ? snapshot.focusPoint : START_COORD_FALLBACK);
  const teamName = normalizeText(snapshot && snapshot.event && snapshot.event.team);
  const teamIndex = state.teams.indexOf(teamName);
  const attackingRow = teamIndex === 1
    ? 1
    : (teamIndex === 0 ? FIELD_ROWS : (shotPoint[0] > FIELD_ROWS / 2 ? FIELD_ROWS : 1));
  const isFarTouchline = shotPoint[1] >= (FIELD_COLS + 1) / 2;
  const attackingCol = teamIndex === 1
    ? (isFarTouchline ? 1 : FIELD_COLS)
    : (isFarTouchline ? FIELD_COLS : 1);
  return [
    attackingRow === 1 ? 0.5 : FIELD_ROWS + 0.5,
    attackingCol === 1 ? 0.5 : FIELD_COLS + 0.5
  ];
}

function getCornerReceptionPoint(cornerPoint) {
  if (!cornerPoint) {
    return null;
  }

  return [
    cornerPoint[0] <= 1 ? 1 : FIELD_ROWS,
    cornerPoint[1] <= 1 ? 1 : FIELD_COLS
  ];
}

function getCornerKickPassInfo(snapshot, sourcePoint = null) {
  if (!snapshot || !isCornerKickNavesShotEvent(snapshot.event)) {
    return null;
  }

  const prevPass = parsePrevPassValue(snapshot.event.prev_pass);
  const passerId = parsePlayerIdReference(snapshot.event.prev_pm)
    || prevPass.pm
    || parseNamedIdReference(snapshot.event.mixed_action, "prev_pm")
    || parseNamedIdReference(snapshot.event.raw_text, "prev_pm");
  const previousState = passerId && snapshot.previousPlayersById ? snapshot.previousPlayersById[passerId] : null;
  const fromPoint = getCornerKickPasserPoint(snapshot, sourcePoint);
  const toPoint = snapshot.focusPoint || (
    prevPass.coords[1]
      ? clampCoord(prevPass.coords[1][0], prevPass.coords[1][1])
      : null
  );
  const passer = resolvePlayerById(passerId, snapshot);

  if (!fromPoint || !toPoint || !passer) {
    return null;
  }

  return {
    fromPoint,
    toPoint,
    passer,
    team: previousState && previousState.team
      ? previousState.team
      : (state.teamByPlayerId[passer.id] || normalizeText(snapshot.event.team))
  };
}

function getCornerKickPasserMarker(snapshot, sourcePoint = null) {
  const passInfo = getCornerKickPassInfo(snapshot, sourcePoint);
  if (!passInfo) {
    return null;
  }

  return {
    ...makePlayerState(
      passInfo.passer,
      passInfo.team,
      passInfo.fromPoint[0],
      passInfo.fromPoint[1],
      "corner-passer",
      snapshot.event.index,
      passInfo.team
    ),
    markerId: `corner-passer:${snapshot.event.index}:${passInfo.passer.id || passInfo.passer.name}`,
    markerPhase: "overlay",
    isCornerPasser: true
  };
}

function getRegularCornerPassInfo(snapshot, sourcePoint = null, nextSnapshot = null) {
  if (!snapshot || !isCornerPassEvent(snapshot.event) || isCornerKickNavesShotEvent(snapshot.event)) {
    return null;
  }

  const passer = parsePlayerValue(snapshot.event.player_with_ball);
  const target = parsePlayerValue(snapshot.event.target);
  const toPoint = getEventPoint(snapshot.event) || sourcePoint || snapshot.focusPoint;
  const fromPoint = getCornerKickPasserPoint(snapshot, toPoint);
  const targetPoint = nextSnapshot && isNavesShotEvent(nextSnapshot.event)
    ? getCornerReceptionPoint(fromPoint)
    : toPoint;
  const team = normalizeText(snapshot.event.team);

  if (!passer || !target || !fromPoint || !targetPoint) {
    return null;
  }

  return {
    fromPoint,
    toPoint: targetPoint,
    passer,
    target,
    team
  };
}

function getRegularCornerPasserMarker(snapshot, sourcePoint = null, nextSnapshot = null) {
  const passInfo = getRegularCornerPassInfo(snapshot, sourcePoint, nextSnapshot);
  if (!passInfo) {
    return null;
  }

  return {
    ...makePlayerState(
      passInfo.passer,
      passInfo.team,
      passInfo.fromPoint[0],
      passInfo.fromPoint[1],
      "corner-passer",
      snapshot.event.index,
      passInfo.team
    ),
    markerId: `regular-corner-passer:${snapshot.event.index}:${passInfo.passer.id || passInfo.passer.name}`,
    markerPhase: "overlay",
    isCornerPasser: true
  };
}

function getRegularCornerTargetMarker(snapshot, sourcePoint = null, nextSnapshot = null) {
  const passInfo = getRegularCornerPassInfo(snapshot, sourcePoint, nextSnapshot);
  if (!passInfo) {
    return null;
  }

  return {
    ...makePlayerState(
      passInfo.target,
      passInfo.team,
      passInfo.toPoint[0],
      passInfo.toPoint[1],
      "target",
      snapshot.event.index,
      passInfo.team
    ),
    markerId: `regular-corner-target:${snapshot.event.index}:${passInfo.target.id || passInfo.target.name}`,
    markerPhase: "overlay",
    isPassTarget: true
  };
}

function getMixedNavesShotPassInfo(snapshot) {
  if (!snapshot || !isNavesShotEvent(snapshot.event)) {
    return null;
  }

  const passerId = parsePlayerIdReference(snapshot.event.prev_pm)
    || parseNamedIdReference(snapshot.event.mixed_action, "prev_pm")
    || parseNamedIdReference(snapshot.event.raw_text, "prev_pm");
  const previousState = passerId && snapshot.previousPlayersById ? snapshot.previousPlayersById[passerId] : null;
  const passer = resolvePlayerById(passerId, snapshot);
  const toPoint = snapshot.focusPoint;

  if (!previousState || !passer || !toPoint) {
    return null;
  }

  return {
    fromPoint: [previousState.row, previousState.col],
    toPoint,
    passer,
    team: previousState.team || state.teamByPlayerId[passer.id] || normalizeText(snapshot.event.team)
  };
}

function getMixedNavesShotPasserMarker(snapshot) {
  const passInfo = getMixedNavesShotPassInfo(snapshot);
  if (!passInfo) {
    return null;
  }

  return {
    ...makePlayerState(
      passInfo.passer,
      passInfo.team,
      passInfo.fromPoint[0],
      passInfo.fromPoint[1],
      "mixed-passer",
      snapshot.event.index,
      passInfo.team
    ),
    markerId: `mixed-passer:${snapshot.event.index}:${passInfo.passer.id || passInfo.passer.name}`,
    markerPhase: "overlay",
    isMixedPasser: true
  };
}

function isPassFollowedByFoul(currentSnapshot, nextSnapshot) {
  if (!currentSnapshot || !nextSnapshot) {
    return false;
  }

  const action = getSnapshotAction(currentSnapshot);
  return isPassAction(action) && isFoulAction(getSnapshotAction(nextSnapshot));
}

function getPassRenderTargetSnapshot(currentSnapshot, nextSnapshot) {
  if (!isPassFollowedByFoul(currentSnapshot, nextSnapshot)) {
    return nextSnapshot;
  }

  const foulIndex = state.snapshots.indexOf(nextSnapshot);
  if (foulIndex < 0) {
    return nextSnapshot;
  }

  return getNextRenderableSnapshot(foulIndex) || nextSnapshot;
}

function getPassRenderTargetPoint(currentSnapshot, nextSnapshot) {
  const targetSnapshot = getPassRenderTargetSnapshot(currentSnapshot, nextSnapshot);
  if (isPassFollowedByFoul(currentSnapshot, nextSnapshot) && targetSnapshot) {
    const rawTargetPoint = getEventPoint(targetSnapshot.event);
    if (rawTargetPoint) {
      return rawTargetPoint;
    }
  }

  if (targetSnapshot && targetSnapshot.focusPoint) {
    return targetSnapshot.focusPoint;
  }

  return getCoordsPair(currentSnapshot.event).to;
}

function getIncomingOpponentMarker(currentSnapshot, nextSnapshot) {
  if (!currentSnapshot) {
    return null;
  }

  const action = String((currentSnapshot.event && currentSnapshot.event.action) || "").toLowerCase();
  const passFollowedByFoul = isPassFollowedByFoul(currentSnapshot, nextSnapshot);
  const opponentWonPass = isFailedPassResult(currentSnapshot.event.result);
  if (!isPassAction(action) || (!passFollowedByFoul && isZeroLikeResult(currentSnapshot.event.result))) {
    return null;
  }

  const target = parsePlayerValue(currentSnapshot.event.target);
  const opponent = parsePlayerValue(currentSnapshot.event.opponent);
  if (!target || !opponent) {
    return null;
  }

  if (nextSnapshot && !passFollowedByFoul) {
    const nextActor = parsePlayerValue(nextSnapshot.event.player_with_ball);
    if (nextActor && !samePlayer(target, nextActor)) {
      return null;
    }
  }

  const targetPoint = getPassRenderTargetPoint(currentSnapshot, nextSnapshot);
  if (!targetPoint) {
    return null;
  }

  const currentTeam = normalizeText(currentSnapshot.event.team);
  const opponentTeam = opponent.id && state.teamByPlayerId[opponent.id]
    ? state.teamByPlayerId[opponent.id]
    : getOtherTeam(currentTeam);

  return {
    ...makePlayerState(
      opponent,
      opponentTeam,
      targetPoint[0],
      targetPoint[1],
      "incoming-opponent",
      currentSnapshot.event.index,
      opponentTeam
    ),
    markerId: `incoming-opponent:${currentSnapshot.event.index}:${opponent.id || opponent.name}`,
    markerPhase: "overlay",
    isIncomingOpponent: !opponentWonPass,
    hasDangerArrow: !opponentWonPass
  };
}

function getPassTargetMarker(currentSnapshot, nextSnapshot) {
  if (!currentSnapshot) {
    return null;
  }

  const action = String((currentSnapshot.event && currentSnapshot.event.action) || "").toLowerCase();
  const passFollowedByFoul = isPassFollowedByFoul(currentSnapshot, nextSnapshot);
  const isFailedTarget = isFailedPassResult(currentSnapshot.event.result);
  if (!isPassAction(action) || (!isFailedTarget && !passFollowedByFoul)) {
    return null;
  }

  const target = parsePlayerValue(currentSnapshot.event.target);
  const targetPoint = getPassRenderTargetPoint(currentSnapshot, nextSnapshot);
  if (!target || !targetPoint) {
    return null;
  }

  const team = normalizeText(currentSnapshot.event.team);
  const targetTeam = target.id && state.teamByPlayerId[target.id]
    ? state.teamByPlayerId[target.id]
    : team;

  return {
    ...makePlayerState(
      target,
      targetTeam,
      targetPoint[0],
      targetPoint[1],
      "pass-target",
      currentSnapshot.event.index,
      targetTeam
    ),
    markerId: `pass-target:${currentSnapshot.event.index}:${target.id || target.name}`,
    markerPhase: "overlay",
    isPassTarget: true,
    isFailedTarget,
    hasDangerArrow: true
  };
}

function getNextRenderableSnapshot(startIndex) {
  for (let index = startIndex + 1; index < state.snapshots.length; index++) {
    const snapshot = state.snapshots[index];
    const action = String((snapshot && snapshot.event && snapshot.event.action) || "").toLowerCase();
    if (!isSubstitutionAction(action)) {
      return snapshot;
    }
  }
  return null;
}

function getPreviousRenderableSnapshot(startIndex) {
  for (let index = startIndex - 1; index >= 0; index--) {
    const snapshot = state.snapshots[index];
    const action = String((snapshot && snapshot.event && snapshot.event.action) || "").toLowerCase();
    if (!isSubstitutionAction(action)) {
      return snapshot;
    }
  }
  return null;
}

function applyFoulDangerMarker(player, foulTeam) {
  return {
    ...player,
    hasDangerArrow: normalizeText(player.team) === foulTeam
  };
}

function getFoulContestPoint(previousSnapshot, nextSnapshot) {
  if (nextSnapshot && nextSnapshot.event) {
    const nextPoint = getEventPoint(nextSnapshot.event);
    if (nextPoint) {
      return nextPoint;
    }
  }

  if (!previousSnapshot || !previousSnapshot.event) {
    return null;
  }

  return getCoordsPair(previousSnapshot.event).to || previousSnapshot.focusPoint;
}

function getFoulContestMarkers(currentSnapshot, previousSnapshot, nextSnapshot, foulTeam) {
  const point = getFoulContestPoint(previousSnapshot, nextSnapshot);
  if (!currentSnapshot || !point) {
    return [];
  }

  const actor = parsePlayerValue(currentSnapshot.event.player_with_ball);
  const opponent = parsePlayerValue(currentSnapshot.event.opponent);
  const actorTeam = actor && actor.id && state.teamByPlayerId[actor.id]
    ? state.teamByPlayerId[actor.id]
    : getOtherTeam(foulTeam);
  const opponentTeam = opponent && opponent.id && state.teamByPlayerId[opponent.id]
    ? state.teamByPlayerId[opponent.id]
    : foulTeam;
  const markers = [];

  if (actor) {
    markers.push(applyFoulDangerMarker({
      ...makePlayerState(
        actor,
        actorTeam,
        point[0],
        point[1],
        "ball",
        currentSnapshot.event.index,
        actorTeam
      ),
      markerId: `foul-actor:${currentSnapshot.event.index}:${actor.id || actor.name}`,
      markerPhase: "overlay",
      isFoulContest: true
    }, foulTeam));
  }

  if (opponent) {
    markers.push(applyFoulDangerMarker({
      ...makePlayerState(
        opponent,
        opponentTeam,
        point[0],
        point[1],
        "foul-opponent",
        currentSnapshot.event.index,
        opponentTeam
      ),
      markerId: `foul-opponent:${currentSnapshot.event.index}:${opponent.id || opponent.name}`,
      markerPhase: "overlay",
      isIncomingOpponent: true,
      isFoulContest: true
    }, foulTeam));
  }

  return markers;
}

function buildScore(events, teams) {
  const score = [0, 0];
  const home = normalizeText(teams[0]);
  const away = normalizeText(teams[1]);

  events.forEach((event) => {
    const action = String(event.action || "").toLowerCase();
    const team = normalizeText(event.team);
    const isGoal = isShotAction(action) && (
      event.result === 1
      || event.result === true
      || event.result === "1"
    );

    if (!isGoal) {
      return;
    }

    if (team === home) {
      score[0] += 1;
    } else if (team === away) {
      score[1] += 1;
    }
  });

  return score;
}

function buildScoreUntilIndex(events, teams, endExclusive) {
  return buildScore(events.slice(0, Math.max(0, endExclusive)), teams);
}

function appendActionLineToPixel(fromPoint, toX, toY, isFailed, extraClass = "") {
  if (!fromPoint) {
    return;
  }

  const from = coordToPercent(fromPoint[0], fromPoint[1], { allowOuterRows: true, allowOuterCols: true });
  const fieldRect = field.getBoundingClientRect();
  const fromX = (from.x / 100) * fieldRect.width;
  const fromY = (from.y / 100) * fieldRect.height;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(length) || length <= 1) {
    return;
  }

  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const line = document.createElement("div");
  line.className = `pass-line ${isFailed ? "fail" : "success"} ${extraClass}`.trim();
  line.style.left = `${fromX}px`;
  line.style.top = `${fromY}px`;
  line.style.width = `${length}px`;
  line.style.setProperty("--pass-angle", `${angle}deg`);
  trailLayer.appendChild(line);
}

function appendActionLine(fromPoint, toPoint, isFailed, extraClass = "") {
  if (!toPoint) {
    return;
  }

  const to = coordToPercent(toPoint[0], toPoint[1]);
  const fieldRect = field.getBoundingClientRect();
  appendActionLineToPixel(
    fromPoint,
    (to.x / 100) * fieldRect.width,
    (to.y / 100) * fieldRect.height,
    isFailed,
    extraClass
  );
}

function renderActionLine(currentSnapshot, nextSnapshot) {
  trailLayer.innerHTML = "";
  if (!currentSnapshot) {
    return;
  }

  const action = String((currentSnapshot.event && currentSnapshot.event.action) || "").toLowerCase();
  if (!isPassAction(action) && !isShotAction(action) && !isCornerKickNavesShotEvent(currentSnapshot.event) && !isCornerKickNavesEvent(currentSnapshot.event) && !isNavesShotEvent(currentSnapshot.event)) {
    return;
  }

  const fromPoint = currentSnapshot.focusPoint;
  if (!fromPoint) {
    return;
  }

  const cornerPassInfo = getCornerKickPassInfo(currentSnapshot);
  if (cornerPassInfo) {
    appendActionLine(cornerPassInfo.fromPoint, cornerPassInfo.toPoint, false, "mixed-pass");
  }

  if (isCornerKickNavesEvent(currentSnapshot.event)) {
    const targetPoint = nextSnapshot && nextSnapshot.focusPoint
      ? nextSnapshot.focusPoint
      : getCoordsPair(currentSnapshot.event).from;
    if (targetPoint) {
      appendActionLine(currentSnapshot.focusPoint, targetPoint, isFailedPassResult(currentSnapshot.event.result), "mixed-pass");
      return;
    }
  }

  const previousSnapshot = getPreviousRenderableSnapshot(state.currentIndex);
  const regularCornerPassInfo = getRegularCornerPassInfo(
    currentSnapshot,
    previousSnapshot && previousSnapshot.focusPoint,
    nextSnapshot
  );
  if (regularCornerPassInfo) {
    appendActionLine(regularCornerPassInfo.fromPoint, regularCornerPassInfo.toPoint, false, "mixed-pass");
    return;
  }

  const mixedNavesShotPassInfo = getMixedNavesShotPassInfo(currentSnapshot);
  if (mixedNavesShotPassInfo) {
    appendActionLine(mixedNavesShotPassInfo.fromPoint, mixedNavesShotPassInfo.toPoint, false, "mixed-pass");
  }

  let toPoint = null;

  if (isPassAction(action)) {
    const targetPoint = getPassRenderTargetPoint(currentSnapshot, nextSnapshot);
    if (!targetPoint) {
      return;
    }
    toPoint = targetPoint;
  } else if (isShotAction(action)) {
    const teamName = normalizeText(currentSnapshot.event.team);
    const isAway = getTeamSide(teamName) === "away";
    const fieldRect = field.getBoundingClientRect();
    const goalX = isAway ? 0 : fieldRect.width;
    const goalY = fieldRect.height / 2;
    const isFailed = !(
      currentSnapshot.event.result === 1
      || currentSnapshot.event.result === true
      || currentSnapshot.event.result === "1"
    );
    appendActionLineToPixel(fromPoint, goalX, goalY, isFailed);
    return;
  }

  const isFailed = isPassAction(action)
    ? isFailedPassResult(currentSnapshot.event.result)
    : !(
      currentSnapshot.event.result === 1
      || currentSnapshot.event.result === true
      || currentSnapshot.event.result === "1"
    );

  appendActionLine(fromPoint, toPoint, isFailed);
}

function getPlayerCellDedupeKey(player) {
  const playerKey = player.id || normalizePlayerNameKey(player.name);
  if (!playerKey) {
    return "";
  }

  return `${playerKey}:${player.row}:${player.col}`;
}

function getMarkerDedupePriority(player) {
  if (player.role === "ball") {
    return 60;
  }

  if (player.markerPhase === "overlay") {
    return 50;
  }

  if (player.markerPhase === "current") {
    return 40;
  }

  if (player.markerPhase === "next") {
    return 10;
  }

  return 0;
}

function dedupeSamePlayerCellMarkers(entries) {
  const deduped = [];
  const indexByKey = new Map();

  entries.forEach((player) => {
    const key = getPlayerCellDedupeKey(player);
    if (!key) {
      deduped.push(player);
      return;
    }

    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(player);
      return;
    }

    const existingPlayer = deduped[existingIndex];
    if (getMarkerDedupePriority(player) > getMarkerDedupePriority(existingPlayer)) {
      deduped[existingIndex] = player;
    }
  });

  return deduped;
}

function renderMarkers(currentSnapshot, nextSnapshot) {
  if (!currentSnapshot && !nextSnapshot) {
    trailLayer.innerHTML = "";
    markerLayer.innerHTML = "";
    state.markerNodes = {};
    return;
  }

  const entries = [];
  const stackMap = new Map();
  const currentAction = String((currentSnapshot && currentSnapshot.event && currentSnapshot.event.action) || "").toLowerCase();
  const isFoulFrame = currentSnapshot && isFoulAction(currentAction);

  if (isFoulFrame) {
    const previousSnapshot = getPreviousRenderableSnapshot(state.currentIndex);
    const foulTeam = normalizeText(currentSnapshot.event.team);
    const previousAction = getSnapshotAction(previousSnapshot);

    if (previousSnapshot) {
      if (isDribbleAction(previousAction)) {
        entries.push(...getFoulContestMarkers(currentSnapshot, previousSnapshot, nextSnapshot, foulTeam));
      }

      const incomingOpponent = getIncomingOpponentMarker(previousSnapshot, currentSnapshot);
      if (incomingOpponent) {
        entries.push(applyFoulDangerMarker(incomingOpponent, foulTeam));
      }

      const passTarget = getPassTargetMarker(previousSnapshot, currentSnapshot);
      if (passTarget) {
        entries.push(applyFoulDangerMarker(passTarget, foulTeam));
      }
    }
  }

  if (currentSnapshot && !isFoulFrame) {
    Object.values(currentSnapshot.players).forEach((player) => {
      if (isCornerPassEvent(currentSnapshot.event)) {
        return;
      }

      entries.push({
        ...player,
        markerId: `current:${player.id}`,
        markerPhase: "current"
      });
    });
  }

  const cornerPasser = !isFoulFrame ? getCornerKickPasserMarker(currentSnapshot) : null;
  if (cornerPasser) {
    entries.push(cornerPasser);
  }

  const previousSnapshot = getPreviousRenderableSnapshot(state.currentIndex);
  const regularCornerPasser = !isFoulFrame
    ? getRegularCornerPasserMarker(currentSnapshot, previousSnapshot && previousSnapshot.focusPoint, nextSnapshot)
    : null;
  if (regularCornerPasser) {
    entries.push(regularCornerPasser);
  }

  const regularCornerTarget = !isFoulFrame
    ? getRegularCornerTargetMarker(currentSnapshot, previousSnapshot && previousSnapshot.focusPoint, nextSnapshot)
    : null;
  if (regularCornerTarget) {
    entries.push(regularCornerTarget);
  }

  const mixedPasser = !isFoulFrame ? getMixedNavesShotPasserMarker(currentSnapshot) : null;
  if (mixedPasser) {
    entries.push(mixedPasser);
  }

  const shotGoalkeeper = !isFoulFrame ? getShotGoalkeeperMarker(currentSnapshot) : null;
  if (shotGoalkeeper) {
    entries.push(shotGoalkeeper);
  }

  const shouldRenderNextSnapshotPlayers = nextSnapshot
    && !isFoulFrame
    && currentAction !== "розыгрыш"
    && !isPassFollowedByFoul(currentSnapshot, nextSnapshot)
    && !isCornerKickNavesShotEvent(nextSnapshot.event);

  if (shouldRenderNextSnapshotPlayers) {
    Object.values(nextSnapshot.players).forEach((player) => {
      if (isNextShotGoalkeeperPlayer(currentSnapshot, nextSnapshot, player)) {
        return;
      }

      entries.push({
        ...player,
        markerId: `next:${player.id}`,
        markerPhase: "next"
      });
    });
  }

  if (nextSnapshot && !isFoulFrame && isCornerKickNavesShotEvent(nextSnapshot.event)) {
    const nextCornerPasser = getCornerKickPasserMarker(nextSnapshot);
    if (nextCornerPasser) {
      entries.push({
        ...nextCornerPasser,
        markerId: `next:${nextCornerPasser.markerId}`,
        markerPhase: "next"
      });
    }
  }

  if (!isFoulFrame) {
    const incomingOpponent = getIncomingOpponentMarker(currentSnapshot, nextSnapshot);
    if (incomingOpponent) {
      entries.push(incomingOpponent);
    }

    const passTarget = getPassTargetMarker(currentSnapshot, nextSnapshot);
    if (passTarget) {
      entries.push(passTarget);
    }
  }

  const visibleEntries = dedupeSamePlayerCellMarkers(entries);
  const nextIds = new Set(visibleEntries.map((player) => player.markerId));

  visibleEntries.forEach((player) => {
    const key = `${player.row}:${player.col}`;
    if (!stackMap.has(key)) {
      stackMap.set(key, []);
    }
    stackMap.get(key).push(player);
  });

  const reusableIds = new Set();
  visibleEntries.forEach((player) => {
    if (player.markerPhase === "current") {
      const previousNextId = `next:${player.id}`;
      if (state.markerNodes[previousNextId]) {
        reusableIds.add(previousNextId);
      }
    }
  });

  Object.keys(state.markerNodes).forEach((playerId) => {
    if (!nextIds.has(playerId) && !reusableIds.has(playerId)) {
      const marker = state.markerNodes[playerId];
      if (!marker.classList.contains("leaving")) {
        marker.classList.add("leaving");
        marker.addEventListener("animationend", () => {
          if (state.markerNodes[playerId] === marker) {
            marker.remove();
            delete state.markerNodes[playerId];
          }
        }, { once: true });
      }
    }
  });

  visibleEntries.forEach((player) => {
    const playerId = player.markerId;
    let marker = state.markerNodes[playerId];
    let isNewMarker = false;
    if (!marker) {
      if (player.markerPhase === "current" && state.markerNodes[`next:${player.id}`]) {
        marker = state.markerNodes[`next:${player.id}`];
        delete state.markerNodes[`next:${player.id}`];
        state.markerNodes[playerId] = marker;
      } else {
        marker = document.createElement("div");
        state.markerNodes[playerId] = marker;
        markerLayer.appendChild(marker);
        isNewMarker = true;
      }
    }

    const side = getTeamSide(player.team);
    const pos = coordToPercent(player.row, player.col, {
      allowOuterRows: player.isGoalkeeper || player.isCornerPasser,
      allowOuterCols: player.isCornerPasser
    });
    const stack = stackMap.get(`${player.row}:${player.col}`) || [player];
    const stackIndex = stack.findIndex((item) => item.markerId === playerId);
    const verticalOffset = player.isCornerPasser
      ? 0
      : (stackIndex - ((stack.length - 1) / 2)) * 50;
    marker.className = `player-marker ${side} ${player.role === "ball" ? "active" : "dim"} ${player.markerPhase === "next" ? "next-step" : ""} ${player.isIncomingOpponent ? "incoming-opponent" : ""} ${player.isPassTarget ? "pass-target" : ""} ${player.isFailedTarget ? "failed-target" : ""} ${player.isCornerPasser ? "corner-passer" : ""} ${player.isMixedPasser ? "mixed-passer" : ""} ${player.isGoalkeeper ? "goalkeeper" : ""}`;
    marker.style.left = `${pos.x}%`;
    marker.style.top = `calc(${pos.y}% + ${verticalOffset}px)`;
    marker.style.zIndex = (player.isIncomingOpponent || player.isPassTarget)
      ? "12"
      : (player.markerPhase === "next" ? "10" : "15");
    marker.innerHTML = `
      <span>${player.markerLabel || "P"}</span>
      <span class="player-tag ${player.hasDangerArrow ? "danger-tag" : ""}">${player.hasDangerArrow ? '<span class="danger-arrow">↓</span>' : ""}${player.name}</span>
    `;

    if (isNewMarker) {
      marker.classList.add("entering");
      marker.addEventListener("animationend", () => {
        marker.classList.remove("entering");
      }, { once: true });
    }
  });
}

function sanitizeEventHtml(rawHtml) {
  const html = rawHtml || "";
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;

  if (!root) {
    return "Описание отсутствует.";
  }

  doc.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        node.removeAttribute(attr.name);
      }
    });

    if (node.tagName.toLowerCase() === "a") {
      const href = node.getAttribute("href") || "";
      if (href.startsWith("/")) {
        node.setAttribute("href", `https://footter.com${href}`);
      }
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  return root.innerHTML || "Описание отсутствует.";
}

function stripLeadingCoordsPrefix(rawHtml) {
  return String(rawHtml || "").replace(/^\s*\[[^\[\]]+\]\s*/, "");
}

function openEpisodeModal() {
  if (!state.snapshots.length) {
    return;
  }

  episodeModalPreviouslyFocused = document.activeElement;
  episodeModalBackdrop.classList.add("open");
  episodeModalBackdrop.setAttribute("aria-hidden", "false");
  episodeModalClose.focus();
}

function closeEpisodeModal() {
  if (!episodeModalBackdrop.classList.contains("open")) {
    return;
  }

  episodeModalBackdrop.classList.remove("open");
  episodeModalBackdrop.setAttribute("aria-hidden", "true");

  if (episodeModalPreviouslyFocused && typeof episodeModalPreviouslyFocused.focus === "function") {
    episodeModalPreviouslyFocused.focus();
  }
  episodeModalPreviouslyFocused = null;
}

function openEventListModal() {
  if (!state.events.length) {
    return;
  }

  eventListModalPreviouslyFocused = document.activeElement;
  eventListModalBackdrop.classList.add("open");
  eventListModalBackdrop.setAttribute("aria-hidden", "false");
  eventListModalClose.focus();
}

function closeEventListModal() {
  if (!eventListModalBackdrop.classList.contains("open")) {
    return;
  }

  eventListModalBackdrop.classList.remove("open");
  eventListModalBackdrop.setAttribute("aria-hidden", "true");

  if (eventListModalPreviouslyFocused && typeof eventListModalPreviouslyFocused.focus === "function") {
    eventListModalPreviouslyFocused.focus();
  }
  eventListModalPreviouslyFocused = null;
}

function renderEventCard(snapshot) {
  if (!snapshot) {
    eventClock.textContent = "Минута -";
    eventAction.textContent = "Нет данных";
    eventResult.textContent = "-";
    eventTeam.innerHTML = "-";
    eventBallPlayer.textContent = "-";
    eventTarget.textContent = "-";
    eventOpponent.textContent = "-";
    eventCoords.textContent = "-";
    currentLogCard.className = "current-log-card";
    currentLogText.innerHTML = "После загрузки здесь появится текст текущего события.";
    return;
  }

  const event = snapshot.event;
  const teamSide = getTeamSide(event.team || "");
  eventClock.textContent = `Минута ${event.time ?? "-"} • Итерация ${event.step ?? "-"}`;
  eventAction.textContent = normalizeActionLabel(event.action);
  eventResult.textContent = getResultLabel(event.result);
  eventTeam.innerHTML = formatTeamName(event.team || "-");
  eventBallPlayer.textContent = makeDisplayName(parsePlayerValue(event.player_with_ball));
  eventTarget.textContent = makeDisplayName(parsePlayerValue(event.target));
  eventOpponent.textContent = makeDisplayName(parsePlayerValue(event.opponent));
  eventCoords.textContent = Array.isArray(event.position) && event.position.length
    ? JSON.stringify(event.position)
    : "-";
  currentLogCard.className = `current-log-card ${teamSide}`;
  currentLogText.innerHTML = sanitizeEventHtml(
    stripLeadingCoordsPrefix(event.cue1 || event.raw_text || "Описание отсутствует.")
  );
}

function renderEventList() {
  eventList.innerHTML = "";
  state.events.forEach((event, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item ${index === state.currentIndex ? "active" : ""}`;
    button.innerHTML = `
      <small>${event.time ?? "-"} мин • шаг ${event.step ?? "-"}</small>
      <strong>${normalizeActionLabel(event.action)}</strong>
      <span>${sanitizeEventHtml(event.cue1 || event.team || "Без текста")}</span>
    `;
    button.addEventListener("click", () => {
      stopPlayback();
      setCurrentIndex(index);
    });
    eventList.appendChild(button);
  });
}

function updateButtons() {
  const hasEvents = state.events.length > 0;
  const lastIndex = Math.max(0, state.events.length - 1);
  playButton.disabled = !hasEvents;
  prevButton.disabled = !hasEvents || state.currentIndex <= 0;
  nextButton.disabled = !hasEvents || state.currentIndex >= lastIndex;
  timelineRange.disabled = !hasEvents;
  timelineLabel.disabled = !hasEvents;
  timelineLabel.title = hasEvents ? "Открыть ленту событий" : "";
  episodeInfoButton.disabled = !hasEvents;
  episodeInfoButton.title = hasEvents ? "Открыть текущий эпизод" : "";
  if (!hasEvents) {
    timelineLabel.setAttribute("aria-label", "Лента событий недоступна");
    episodeInfoButton.setAttribute("aria-label", "Текущий эпизод недоступен");
  }
}

function setCurrentIndex(index) {
  const lastIndex = Math.max(0, state.snapshots.length - 1);
  state.currentIndex = Math.max(0, Math.min(lastIndex, index));
  const currentSnapshot = state.snapshots[state.currentIndex] || null;
  const nextSnapshot = getNextRenderableSnapshot(state.currentIndex);
  state.score = buildScoreUntilIndex(state.events, state.teams, state.currentIndex + 1);
  timelineRange.value = String(state.currentIndex);
  timelineLabel.textContent = `${state.currentIndex + 1} / ${state.snapshots.length}`;
  timelineLabel.setAttribute("aria-label", `Открыть ленту событий, выбран эпизод ${state.currentIndex + 1} из ${state.snapshots.length}`);
  episodeInfoButton.setAttribute("aria-label", `Открыть текущий эпизод ${state.currentIndex + 1} из ${state.snapshots.length}`);
  fillSummary();
  renderActionLine(currentSnapshot, nextSnapshot);
  renderMarkers(currentSnapshot, nextSnapshot);
  renderEventCard(state.snapshots[state.currentIndex]);
  renderEventList();
  updateButtons();
}

function stopPlayback() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  playButton.textContent = "Play";
}

function schedulePlaybackLegacyBroken() {
  updateProgress(
    "source",
    pageFile
      ? `Источник подтверждён: локальный файл ${pageFile.name}.`
      : `Источник подтверждён: ссылка ${pageUrl}.`,
    "done"
  );

  updateProgress(
    "source",
    pageFile
      ? `Источник подтверждён: локальный файл ${pageFile.name}.`
      : `Источник подтверждён: ссылка ${pageUrl}.`,
    "done"
  );
  stopPlayback();
  if (state.currentIndex >= state.snapshots.length - 1) {
    setCurrentIndex(0);
  }
  playButton.textContent = "Pause";

  const tick = () => {
    if (state.currentIndex >= state.snapshots.length - 1) {
      stopPlayback();
      return;
    }

    setCurrentIndex(state.currentIndex + 1);
    state.timer = setTimeout(tick, Number(speedSelect.value));
  };

  state.timer = setTimeout(tick, Number(speedSelect.value));
}

function schedulePlayback() {
  stopPlayback();
  if (state.currentIndex >= state.snapshots.length - 1) {
    setCurrentIndex(0);
  }
  playButton.textContent = "Pause";

  const tick = () => {
    if (state.currentIndex >= state.snapshots.length - 1) {
      stopPlayback();
      return;
    }

    setCurrentIndex(state.currentIndex + 1);
    state.timer = setTimeout(tick, Number(speedSelect.value));
  };

  state.timer = setTimeout(tick, Number(speedSelect.value));
}

function fillSummary() {
  const home = state.teams[0] || "Команда 1";
  const away = state.teams[1] || "Команда 2";
  const currentEvent = state.events[state.currentIndex];
  const minuteLabel = currentEvent && currentEvent.time !== undefined ? `${currentEvent.time} мин` : "-";
  teamsLabel.innerHTML = state.teams.length
    ? `
      <span class="scoreboard">
        <span class="scoreboard-team home">
          <span class="scoreboard-score">${state.score[0] ?? 0}</span>
          <span class="scoreboard-name team-home">${home}</span>
        </span>
        <span class="scoreboard-divider">:</span>
        <span class="scoreboard-team away">
          <span class="scoreboard-score">${state.score[1] ?? 0}</span>
          <span class="scoreboard-name team-away">${away}</span>
        </span>
      </span>
    `
    : "-";
  matchMinute.textContent = minuteLabel;
}

function enableTimeline() {
  const max = Math.max(0, state.events.length - 1);
  timelineRange.max = String(max);
  timelineRange.min = "0";
  timelineRange.value = "0";
}

function normalizeMatchQueryValue(value) {
  const trimmedValue = value.trim();
  if (/^\d+$/.test(trimmedValue)) {
    return `https://footter.com/match/${trimmedValue}/`;
  }
  return trimmedValue;
}

function getMatchUrlFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("url") || params.get("match_url") || params.get("match");
  return queryValue ? normalizeMatchQueryValue(queryValue) : "";
}

function isLocalResourceLaunch() {
  return window.location.protocol === "file:" || window.location.protocol === "res:";
}

function syncLocalSourceVisibility() {
  localSourceGrid.classList.toggle("hidden", !isLocalResourceLaunch());
}

async function parseMatchPage() {
  const pageUrl = urlInput.value.trim();
  const pageFile = pageFileInput.files && pageFileInput.files[0] ? pageFileInput.files[0] : null;
  createProgressFlow([
    { key: "source", title: "Проверка источника", description: "Понимаем, откуда брать HTML матча." },
    { key: "match", title: "Загрузка страницы матча", description: "Читаем локальный файл или запрашиваем страницу." },
    { key: "log", title: "Поиск match log", description: "Ищем `#full_log` или отдельную страницу лога." },
    { key: "events", title: "Разбор событий", description: "Преобразуем HTML в структуру событий." },
    { key: "build", title: "Сборка визуализации", description: "Строим таймлайн, счёт и позиции игроков." }
  ]);
  if (!pageUrl) {
    if (!pageFile) {
      failProgress("source", "Источник не выбран. Нужна ссылка или локальный HTML-файл.");
      setStatus("Нужна ссылка или локальный HTML матча.", true);
      return;
    }
  }

  if (!pageUrl && !pageFile) {
    failProgress("source", "Источник не выбран. Укажи ссылку или файл.");
    setStatus("Нужен источник данных.", true);
    return;
  }

  stopPlayback();
  closeEpisodeModal();
  closeEventListModal();
  setStatus("Загрузка страницы...");
  teamsLabel.innerHTML = "-";
  matchMinute.textContent = "-";
  timelineLabel.textContent = "0 / 0";
  timelineRange.max = "0";
  timelineRange.value = "0";
  state.events = [];
  state.snapshots = [];
  state.teams = [];
  state.score = [0, 0];
  state.teamByPlayerId = {};
  state.playerById = {};
  state.playerPositionById = {};
  state.markerNodes = {};
  renderMarkers(null);
  renderEventCard(null);
  renderEventList();
  updateButtons();

  try {
    let pageDoc = null;
    let logDoc = null;
    let finalLogUrl = pageUrl || getLocalSourceLabel(pageFile);
    let statusText = "";

    if (pageFile) {
      updateProgress("match", `Читаю локальный файл ${pageFile.name}...`);
      const pageHtml = await readFileText(pageFile);
      pageDoc = parseHtml(pageHtml);
      statusText = `Матч загружен из локального файла ${pageFile.name}.`;
    } else if (pageUrl) {
      updateProgress("match", "Запрашиваю страницу матча...");
      const pageResult = await fetchWithFallbacks(pageUrl);
      pageDoc = parseHtml(pageResult.text);
      statusText = `Страница загружена через ${pageResult.resolvedVia}.`;
    }

    if (pageDoc) {
      updateProgress("log", "Проверяю, есть ли лог прямо на странице матча...");
      const fullLogOnPage = pageDoc.querySelector("#full_log");

      if (fullLogOnPage && normalizeText(fullLogOnPage.textContent)) {
        logDoc = pageDoc;
        finalLogUrl = pageUrl || getLocalSourceLabel(pageFile);
        updateProgress("log", "Лог найден в основном HTML. Дополнительная загрузка не нужна.", "done");
      } else {
        const detectedLogUrl = pageUrl ? extractMatchLogUrl(pageDoc, pageUrl) : null;
        if (!detectedLogUrl) {
          throw new Error("В выбранном локальном HTML нет содержимого #full_log. Выберите HTML, где уже есть лог матча, или используйте ссылку.");
        }

        updateProgress("log", `Нашёл отдельный match log. Загружаю ${detectedLogUrl}...`);
        const logResult = await fetchWithFallbacks(detectedLogUrl);
        logDoc = parseHtml(logResult.text);
        finalLogUrl = detectedLogUrl;
        updateProgress("log", "Match log загружен, обновляю структуру данных...", "done");
        statusText = `${statusText} Match log загружен через ${logResult.resolvedVia}.`.trim();
      }
    }

    if (!logDoc) {
      throw new Error("Не удалось получить HTML match_log.");
    }

    updateProgress("events", "Читаю и нормализую события матча...");
    const fullLog = logDoc.querySelector("#full_log") || logDoc.body;
    const rendered = renderFullLog(fullLog);
    const events = rendered.events.filter((event) => event.action || event.cue1 || event.position);

    updateProgress("build", `Собираю визуализацию по ${events.length} событиям...`);
    state.events = events;
    state.text = rendered.text;
    state.teams = extractTeamsFromMatchDoc(pageDoc || logDoc, events);
    state.score = buildScore(events, state.teams);
    state.teamByPlayerId = inferTeamByPlayer(events, state.teams);
    state.playerById = buildPlayerInfoById(events);
    state.playerPositionById = buildPlayerPositionById(
      events,
      extractPositionByPlayerName(pageDoc || logDoc)
    );
    state.snapshots = buildSnapshots(events, state.teams, state.teamByPlayerId);

    fillSummary();
    enableTimeline();
    document.body.classList.add("loaded");
    scheduleFieldLayoutRefresh();

    if (state.snapshots.length) {
      setCurrentIndex(0);
    } else {
      renderEventCard(null);
    }

    completeProgress(`Готово. Загружено ${events.length} событий${finalLogUrl ? ` из ${finalLogUrl}.` : "."}`);
    setStatus(statusText);
  } catch (error) {
    const errorMessage = String(error && error.message ? error.message : error);
    if (errorMessage.includes("getsky-proxy") || errorMessage.includes("direct:") || errorMessage.includes("allorigins") || errorMessage.includes("corsproxy")) {
      const hostedFetchMessage = buildHostedRemoteFetchMessage(errorMessage);
      failProgress("match", hostedFetchMessage);
      setStatus(hostedFetchMessage, true);
      return;
    }
    const corsHint = window.location.protocol === "file:"
      ? " Страница открыта как file://, поэтому прямой fetch на footter блокируется браузером. Используйте локальный HTML с уже сохранённым логом или откройте страницу через локальный http-сервер."
      : "";
    failProgress("match", `${errorMessage}${corsHint}`);
    setStatus(`${errorMessage}${corsHint}`, true);
  }
}

loadButton.addEventListener("click", parseMatchPage);
urlInput.addEventListener("paste", () => {
  setTimeout(() => {
    if (urlInput.value.trim()) {
      parseMatchPage();
    }
  }, 0);
});
pageFileInput.addEventListener("change", () => {
  if (pageFileInput.files && pageFileInput.files[0]) {
    parseMatchPage();
  }
});
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    parseMatchPage();
  }
});
timelineLabel.addEventListener("click", openEventListModal);
episodeInfoButton.addEventListener("click", openEpisodeModal);
episodeModalClose.addEventListener("click", closeEpisodeModal);
episodeModalBackdrop.addEventListener("click", (event) => {
  if (event.target === episodeModalBackdrop) {
    closeEpisodeModal();
  }
});
eventListModalClose.addEventListener("click", closeEventListModal);
eventListModalBackdrop.addEventListener("click", (event) => {
  if (event.target === eventListModalBackdrop) {
    closeEventListModal();
  }
});
function isTimelineShortcutTarget(target) {
  if (!target) {
    return false;
  }
  const tagName = target.tagName ? target.tagName.toLowerCase() : "";
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function moveTimelineBy(delta) {
  if (!state.snapshots.length) {
    return false;
  }
  const nextIndex = state.currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= state.snapshots.length) {
    return false;
  }
  stopPlayback();
  setCurrentIndex(nextIndex);
  return true;
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeEpisodeModal();
    closeEventListModal();
    return;
  }

  if (event.altKey || event.ctrlKey || event.metaKey || isTimelineShortcutTarget(event.target)) {
    return;
  }

  if (event.key === "ArrowLeft" && moveTimelineBy(-1)) {
    event.preventDefault();
  } else if (event.key === "ArrowRight" && moveTimelineBy(1)) {
    event.preventDefault();
  }
});

syncLocalSourceVisibility();

const queryMatchUrl = getMatchUrlFromQuery();
if (queryMatchUrl) {
  urlInput.value = queryMatchUrl;
  parseMatchPage();
}

playButton.addEventListener("click", () => {
  if (state.timer) {
    stopPlayback();
  } else {
    schedulePlayback();
  }
});

prevButton.addEventListener("click", () => {
  moveTimelineBy(-1);
});

nextButton.addEventListener("click", () => {
  moveTimelineBy(1);
});

timelineRange.addEventListener("input", () => {
  stopPlayback();
  setCurrentIndex(Number(timelineRange.value));
});

createFieldLabels();
resizeField();
renderEventCard(null);
updateButtons();
window.addEventListener("resize", () => {
  refreshFieldLayout();
});
if ("ResizeObserver" in window) {
  fieldResizeObserver = new ResizeObserver(() => {
    refreshFieldLayout();
  });
  fieldResizeObserver.observe(fieldPanel);
}
