import { TEAM_COLORS } from "./constants.js";
import { initializeApp, wireAppEvents } from "./app/bootstrap.js";
import { coerceValue, divhistKeyMap, parsePrevPassValue } from "./parsers/events.js";
import {
  buildScore,
  buildScoreUntilIndex,
  getResultLabel,
  getSnapshotAction,
  isCornerKickNavesEvent,
  isCornerKickNavesShotEvent,
  isCornerPassEvent,
  isDribbleAction,
  isFailedPassResult,
  isFoulAction,
  isGoalEvent,
  isNavesShotEvent,
  isPassAction,
  isShotAction,
  isSubstitutionAction,
  isZeroLikeResult,
  normalizeActionLabel,
  samePlayer
} from "./match/actions.js";
import {
  clampCoord,
  coordToPercent,
  getCoordsPair,
  getCornerKickPasserPoint,
  getCornerReceptionPoint,
  getEventPoint,
  getShotGoalPoint
} from "./field/geometry.js";
import {
  buildPlayerInfoById,
  buildPlayerPositionById,
  extractPositionByPlayerName,
  makeDisplayName
} from "./match/players.js";
import { buildSnapshots } from "./match/snapshots.js";
import { extractTeamsFromMatchDoc, inferTeamByPlayer } from "./match/teams.js";
import { parseNamedIdReference, parsePlayerIdReference, parsePlayerValue } from "./parsers/players.js";
import {
  buildHostedRemoteFetchMessage,
  extractMatchLogUrl,
  fetchWithFallbacks,
  parseHtml,
  readFileText
} from "./services/footter-loader.js";
import { createFieldLayout } from "./render/field-layout.js";
import { getDomElements } from "./ui/dom.js";
import { createModalController } from "./ui/modals.js";
import { createProgressController } from "./ui/progress.js";
import { normalizeText, slugifyKey } from "./utils/text.js";

const elements = getDomElements();
const {
  urlInput,
  loadButton,
  localSourceGrid,
  pageFileInput,
  playButton,
  prevButton,
  nextButton,
  speedSelect,
  timelineRange,
  timelineLabel,
  episodeInfoButton,
  episodeModalBackdrop,
  episodeModalClose,
  eventListModalBackdrop,
  eventListModalClose,
  teamsLabel,
  matchMinute,
  fieldPanel,
  field,
  currentLogCard,
  currentLogText,
  trailLayer,
  markerLayer,
  eventList,
  eventClock,
  eventAction,
  eventResult,
  eventTeam,
  eventBallPlayer,
  eventTarget,
  eventOpponent,
  eventCoords,
  statusNode
} = elements;
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
  markerNodes: {},
  actionLineKey: null
};

const {
  createProgressFlow,
  updateProgress,
  completeProgress,
  failProgress
} = createProgressController(elements);

const {
  createFieldLabels,
  resizeField,
  refreshFieldLayout,
  scheduleFieldLayoutRefresh
} = createFieldLayout(elements);

const {
  openEpisodeModal,
  closeEpisodeModal,
  openEventListModal,
  closeEventListModal
} = createModalController(elements, {
  hasEvents: () => state.events.length > 0
});
function setStatus(message, isError) {
  statusNode.textContent = message;
  statusNode.className = isError ? "status error" : "status";
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

function getTeamSide(teamName) {
  const index = state.teams.indexOf(teamName);
  return TEAM_COLORS[index] || "home";
}

function formatTeamName(teamName) {
  const side = getTeamSide(teamName);
  const className = side === "away" ? "team-away" : "team-home";
  return `<span class="${className}">${teamName || "-"}</span>`;
}

function getOtherTeam(teamName) {
  return state.teams.find((item) => item !== teamName) || teamName;
}

function getShotGoalkeeperMarker(snapshot) {
  if (!snapshot || !snapshot.event || !isShotAction(getSnapshotAction(snapshot))) {
    return null;
  }

  const shotTeam = normalizeText(snapshot.event.team);
  const goalkeeperTeam = getOtherTeam(shotTeam);
  const point = getShotGoalPoint(shotTeam, state.teams);
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

function getCornerKickPassInfo(snapshot, sourcePoint = null) {
  if (!snapshot || snapshot.event.prevPassMaterialized || !isCornerKickNavesShotEvent(snapshot.event)) {
    return null;
  }

  const prevPass = parsePrevPassValue(snapshot.event.prev_pass);
  const passerId = parsePlayerIdReference(snapshot.event.prev_pm)
    || prevPass.pm
    || parseNamedIdReference(snapshot.event.mixed_action, "prev_pm")
    || parseNamedIdReference(snapshot.event.raw_text, "prev_pm");
  const previousState = passerId && snapshot.previousPlayersById ? snapshot.previousPlayersById[passerId] : null;
  const fromPoint = getCornerKickPasserPoint(snapshot, state.teams, sourcePoint);
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
  const fromPoint = getCornerKickPasserPoint(snapshot, state.teams, toPoint);
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
  if (!snapshot || snapshot.event.prevPassMaterialized || !isNavesShotEvent(snapshot.event)) {
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

function getPrevPassStepTargetMarker(currentSnapshot, nextSnapshot) {
  if (!currentSnapshot || !currentSnapshot.event || !currentSnapshot.event.isPrevPassStep) {
    return null;
  }

  const target = parsePlayerValue(currentSnapshot.event.target);
  const targetPoint = getCoordsPair(currentSnapshot.event).to;
  if (!target || !targetPoint) {
    return null;
  }

  const nextActor = nextSnapshot ? parsePlayerValue(nextSnapshot.event.player_with_ball) : null;
  if (nextActor && !samePlayer(target, nextActor)) {
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
    markerId: `prev-pass-target:${currentSnapshot.event.index}:${target.id || target.name}`,
    markerPhase: "overlay",
    isPassTarget: true
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
  if (currentSnapshot && currentSnapshot.event && currentSnapshot.event.isPrevPassStep) {
    return getCoordsPair(currentSnapshot.event).to;
  }

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
  const currentSourceIndex = getSnapshotSourceIndex(state.snapshots[startIndex], startIndex);
  for (let index = startIndex + 1; index < state.snapshots.length; index++) {
    const snapshot = state.snapshots[index];
    if (getSnapshotSourceIndex(snapshot, index) === currentSourceIndex) {
      continue;
    }

    const action = String((snapshot && snapshot.event && snapshot.event.action) || "").toLowerCase();
    if (!isSubstitutionAction(action)) {
      return snapshot;
    }
  }
  return null;
}

function getPreviousRenderableSnapshot(startIndex) {
  const currentSourceIndex = getSnapshotSourceIndex(state.snapshots[startIndex], startIndex);
  for (let index = startIndex - 1; index >= 0; index--) {
    const snapshot = state.snapshots[index];
    if (getSnapshotSourceIndex(snapshot, index) === currentSourceIndex) {
      continue;
    }

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

function isFinalSentenceStep(event) {
  return !event
    || !event.sourceSentenceCount
    || event.sourceSentenceCount <= 1
    || event.sourceSentenceIndex >= event.sourceSentenceCount - 1;
}

function isScoredShotEvent(event) {
  const action = String((event && event.action) || "").toLowerCase();
  return isShotAction(action) && (
    event.result === 1
    || event.result === true
    || event.result === "1"
  );
}

function isPendingGoalSentence(event) {
  return isScoredShotEvent(event) && !isFinalSentenceStep(event);
}

function getActionLineTone(event) {
  return isFinalSentenceStep(event) ? "final" : "pending";
}

function appendActionLineToPixel(fromPoint, toX, toY, isFailed, extraClass = "", isPending = false) {
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
  line.className = `pass-line ${isPending ? "pending" : (isFailed ? "fail" : "success")} ${extraClass}`.trim();
  line.style.left = `${fromX}px`;
  line.style.top = `${fromY}px`;
  line.style.width = `${length}px`;
  line.style.setProperty("--pass-angle", `${angle}deg`);
  trailLayer.appendChild(line);
}

function appendActionLine(fromPoint, toPoint, isFailed, extraClass = "", isPending = false) {
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
    extraClass,
    isPending
  );
}

function getActionLineRenderKey(currentSnapshot, nextSnapshot) {
  if (!currentSnapshot) {
    return "";
  }

  const fieldRect = field.getBoundingClientRect();
  return [
    getSnapshotSourceIndex(currentSnapshot, state.currentIndex),
    getSnapshotSourceIndex(nextSnapshot, -1),
    getActionLineTone(currentSnapshot.event),
    Math.round(fieldRect.width),
    Math.round(fieldRect.height)
  ].join(":");
}

function renderActionLine(currentSnapshot, nextSnapshot) {
  const actionLineKey = getActionLineRenderKey(currentSnapshot, nextSnapshot);
  if (state.actionLineKey === actionLineKey) {
    return;
  }
  state.actionLineKey = actionLineKey;
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
  const isPendingLine = !isFinalSentenceStep(currentSnapshot.event);

  const cornerPassInfo = getCornerKickPassInfo(currentSnapshot);
  if (cornerPassInfo) {
    appendActionLine(cornerPassInfo.fromPoint, cornerPassInfo.toPoint, false, "mixed-pass", isPendingLine);
  }

  if (isCornerKickNavesEvent(currentSnapshot.event)) {
    const targetPoint = nextSnapshot && nextSnapshot.focusPoint
      ? nextSnapshot.focusPoint
      : getCoordsPair(currentSnapshot.event).from;
    if (targetPoint) {
      appendActionLine(currentSnapshot.focusPoint, targetPoint, isFailedPassResult(currentSnapshot.event.result), "mixed-pass", isPendingLine);
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
    appendActionLine(regularCornerPassInfo.fromPoint, regularCornerPassInfo.toPoint, false, "mixed-pass", isPendingLine);
    return;
  }

  const mixedNavesShotPassInfo = getMixedNavesShotPassInfo(currentSnapshot);
  if (mixedNavesShotPassInfo) {
    appendActionLine(mixedNavesShotPassInfo.fromPoint, mixedNavesShotPassInfo.toPoint, false, "mixed-pass", isPendingLine);
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
    appendActionLineToPixel(fromPoint, goalX, goalY, isFailed, "", isPendingLine);
    return;
  }

  const isFailed = isPassAction(action)
    ? isFailedPassResult(currentSnapshot.event.result)
    : !(
      currentSnapshot.event.result === 1
      || currentSnapshot.event.result === true
      || currentSnapshot.event.result === "1"
    );

  appendActionLine(fromPoint, toPoint, isFailed, "", isPendingLine);
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

function isOutcomeMarker(player) {
  return Boolean(player && (
    player.isIncomingOpponent
    || player.isPassTarget
    || player.isFoulContest
    || player.role === "incoming-opponent"
  ));
}

function applyPendingOutcomeMarker(player) {
  if (!isOutcomeMarker(player)) {
    return player;
  }

  return {
    ...player,
    hasDangerArrow: false,
    isIncomingOpponent: false,
    isFailedTarget: false,
    isPendingOutcomeMarker: true
  };
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

  const shouldHideNextKickoffPlayer = currentSnapshot
    && nextSnapshot
    && isPendingGoalSentence(currentSnapshot.event)
    && getSnapshotAction(nextSnapshot) === "розыгрыш";
  const shouldRenderNextSnapshotPlayers = nextSnapshot
    && !isFoulFrame
    && !shouldHideNextKickoffPlayer
    && !(currentSnapshot && currentSnapshot.event && currentSnapshot.event.isPrevPassStep)
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

    const prevPassTarget = getPrevPassStepTargetMarker(currentSnapshot, nextSnapshot);
    if (prevPassTarget) {
      entries.push(prevPassTarget);
    }
  }

  const shouldDeferOutcomeMarkers = currentSnapshot && !isFinalSentenceStep(currentSnapshot.event);
  const preparedEntries = shouldDeferOutcomeMarkers
    ? entries.map(applyPendingOutcomeMarker)
    : entries;
  const visibleEntries = dedupeSamePlayerCellMarkers(preparedEntries);
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
    marker.className = `player-marker ${side} ${player.role === "ball" ? "active" : "dim"} ${player.markerPhase === "next" ? "next-step" : ""} ${player.isIncomingOpponent ? "incoming-opponent" : ""} ${player.isPassTarget ? "pass-target" : ""} ${player.isFailedTarget ? "failed-target" : ""} ${player.isCornerPasser ? "corner-passer" : ""} ${player.isMixedPasser ? "mixed-passer" : ""} ${player.isGoalkeeper ? "goalkeeper" : ""} ${player.isPendingOutcomeMarker ? "pending-outcome" : ""}`;
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

function htmlToPlainText(rawHtml) {
  const doc = new DOMParser().parseFromString(`<div>${rawHtml || ""}</div>`, "text/html");
  return normalizeText((doc.body.firstElementChild && doc.body.firstElementChild.textContent) || rawHtml || "");
}

function splitDescriptionSentences(rawHtml) {
  const text = htmlToPlainText(stripLeadingCoordsPrefix(rawHtml));
  if (!text) {
    return [];
  }

  const matches = text.match(/[^.!?…]+(?:[.!?…]+(?=\s|$)|$)/g) || [];
  const sentences = matches.map((sentence) => normalizeText(sentence)).filter(Boolean);
  return sentences.length ? sentences : [text];
}

function getEventDescriptionText(event) {
  return event.cue1 || event.raw_text || event.team || "";
}

function getEventSourceIndex(event, fallbackIndex) {
  return event && event.sourceEventIndex !== undefined
    ? event.sourceEventIndex
    : (event && event.index !== undefined ? event.index : fallbackIndex);
}

function sameCoordPair(leftCoords, rightCoords) {
  if (!Array.isArray(leftCoords) || !Array.isArray(rightCoords) || leftCoords.length < 2 || rightCoords.length < 2) {
    return false;
  }

  return leftCoords[0][0] === rightCoords[0][0]
    && leftCoords[0][1] === rightCoords[0][1]
    && leftCoords[1][0] === rightCoords[1][0]
    && leftCoords[1][1] === rightCoords[1][1];
}

function isPrevPassDuplicateOfEvent(prevPass, event) {
  if (!prevPass || !event) {
    return false;
  }

  const prevAction = String(prevPass.action || "").toLowerCase();
  const eventAction = String(event.action || "").toLowerCase();
  const sameAction = prevAction && eventAction && prevAction === eventAction;
  const sameTime = prevPass.time === "" || event.time === undefined || prevPass.time === event.time;
  const sameStep = prevPass.step === "" || event.step === undefined || prevPass.step === event.step;
  const sameCoords = sameCoordPair(prevPass.coords, event.position);
  return Boolean(sameAction && sameTime && sameStep && sameCoords);
}

function getPlayerLabelById(playerId, playerById) {
  const id = parsePlayerIdReference(playerId);
  if (!id) {
    return "";
  }

  const player = playerById[id];
  if (player && player.label) {
    return player.label;
  }

  return `${id} ID ${id}`;
}

function getPrevPassTeam(prevPass, event, teams) {
  if (prevPass.team) {
    return prevPass.team;
  }

  if (prevPass.teamIndex !== "" && teams[prevPass.teamIndex]) {
    return teams[prevPass.teamIndex];
  }

  return event.team || "";
}

function buildPrevPassTimelineEvent(event, prevPass, cue1, playerById, teams, suffix) {
  const targetFromPrevPass = prevPass.target || getPlayerLabelById(prevPass.pr, playerById);
  const target = targetFromPrevPass || event.player_with_ball || "";
  const opponent = prevPass.opponent || getPlayerLabelById(prevPass.pe, playerById) || "";
  const playerWithBall = prevPass.player_with_ball
    || getPlayerLabelById(prevPass.pm || event.prev_pm, playerById)
    || "";
  const eventStartPoint = getEventPoint(event);
  const prevPassPosition = prevPass.coords.length >= 2 && eventStartPoint
    ? [prevPass.coords[0], eventStartPoint]
    : prevPass.coords;

  return {
    index: `${event.index}:prev_pass:${suffix}`,
    sourceEventIndex: `${getEventSourceIndex(event, suffix)}:prev_pass`,
    isPrevPassStep: true,
    action: prevPass.action || "pass",
    time: prevPass.time !== "" ? prevPass.time : event.time,
    step: prevPass.step !== "" ? prevPass.step : event.step,
    team: getPrevPassTeam(prevPass, event, teams),
    position: prevPassPosition,
    result: prevPass.result !== "" ? prevPass.result : event.result,
    player_with_ball: playerWithBall,
    target,
    opponent,
    cue1: cue1 || prevPass.cue1 || event.prev_pass || "",
    raw_text: prevPass.cue1 || event.prev_pass || "",
    prevPassForEventIndex: getEventSourceIndex(event, suffix)
  };
}

function expandEventsWithPrevPassSteps(events, teams, playerById) {
  const expanded = [];

  events.forEach((event, eventIndex) => {
    const prevPass = parsePrevPassValue(event.prev_pass);
    const hasPrevPassStep = prevPass.action || prevPass.coords.length >= 2 || prevPass.pm || prevPass.pr;
    const previousEvent = events[eventIndex - 1] || null;
    const shouldMaterialize = hasPrevPassStep && !isPrevPassDuplicateOfEvent(prevPass, previousEvent);

    if (!shouldMaterialize) {
      expanded.push(event);
      return;
    }

    const sentences = splitDescriptionSentences(getEventDescriptionText(event));
    const consumeLeadingSentence = !prevPass.cue1 && sentences.length > 1;
    const prevPassCue = prevPass.cue1 || (consumeLeadingSentence ? sentences[0] : "");
    expanded.push(buildPrevPassTimelineEvent(event, prevPass, prevPassCue, playerById, teams, eventIndex));
    expanded.push({
      ...event,
      prevPassMaterialized: true,
      omitLeadingSentenceCount: consumeLeadingSentence ? 1 : 0
    });
  });

  return expanded;
}

function buildEventSentenceTimeline(events, baseSnapshots) {
  const timelineEvents = [];
  const timelineSnapshots = [];

  events.forEach((event, eventIndex) => {
    const baseSnapshot = baseSnapshots[eventIndex];
    const sentences = splitDescriptionSentences(getEventDescriptionText(event));
    const visibleSentences = sentences.slice(event.omitLeadingSentenceCount || 0);
    const steps = visibleSentences.length ? visibleSentences : [stripLeadingCoordsPrefix(getEventDescriptionText(event)) || "Описание отсутствует."];
    const sourceEventIndex = getEventSourceIndex(event, eventIndex);
    const isGoal = isGoalEvent(event);

    steps.forEach((sentence, sentenceIndex) => {
      const isLastSentenceStep = sentenceIndex === steps.length - 1;
      const stepEvent = {
        ...event,
        cue1: sentence,
        sourceEventIndex,
        sourceSentenceIndex: sentenceIndex,
        sourceSentenceCount: steps.length,
        isGoalScoringStep: isGoal ? isLastSentenceStep : undefined
      };

      timelineEvents.push(stepEvent);
      timelineSnapshots.push({
        ...baseSnapshot,
        event: stepEvent,
        sourceEventIndex,
        sourceSnapshotIndex: eventIndex
      });
    });
  });

  return {
    events: timelineEvents,
    snapshots: timelineSnapshots
  };
}

function getSnapshotSourceIndex(snapshot, fallbackIndex) {
  if (!snapshot) {
    return null;
  }

  if (snapshot.sourceEventIndex !== undefined) {
    return snapshot.sourceEventIndex;
  }

  return getEventSourceIndex(snapshot.event, fallbackIndex);
}

function getEventStepLabel(event) {
  const base = `${event.time ?? "-"} мин • шаг ${event.step ?? "-"}`;
  if (!event || !event.sourceSentenceCount || event.sourceSentenceCount <= 1) {
    return base;
  }

  return `${base} • фраза ${event.sourceSentenceIndex + 1}/${event.sourceSentenceCount}`;
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
  const isGoal = isGoalEvent(event);
  eventClock.textContent = `Минута ${event.time ?? "-"} • Итерация ${event.step ?? "-"}${event.sourceSentenceCount > 1 ? ` • Фраза ${event.sourceSentenceIndex + 1}/${event.sourceSentenceCount}` : ""}`;
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
  if (isGoal) {
    void currentLogCard.offsetWidth;
    currentLogCard.classList.add("goal-event");
  }
}

function renderEventList() {
  eventList.innerHTML = "";
  state.events.forEach((event, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item ${index === state.currentIndex ? "active" : ""}`;
    button.innerHTML = `
      <small>${getEventStepLabel(event)}</small>
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

  const getPlaybackDelay = () => {
    const baseDelay = Number(speedSelect.value) || 0;
    const currentEvent = state.events[state.currentIndex];
    return baseDelay * (isGoalEvent(currentEvent) ? 2 : 1);
  };

  const tick = () => {
    if (state.currentIndex >= state.snapshots.length - 1) {
      stopPlayback();
      return;
    }

    setCurrentIndex(state.currentIndex + 1);
    state.timer = setTimeout(tick, getPlaybackDelay());
  };

  state.timer = setTimeout(tick, getPlaybackDelay());
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
  state.actionLineKey = null;
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
    state.text = rendered.text;
    state.teams = extractTeamsFromMatchDoc(pageDoc || logDoc, events);
    const initialPlayerById = buildPlayerInfoById(events);
    const timelineEvents = expandEventsWithPrevPassSteps(events, state.teams, initialPlayerById);
    state.teamByPlayerId = inferTeamByPlayer(timelineEvents, state.teams);
    state.playerById = buildPlayerInfoById(timelineEvents);
    state.playerPositionById = buildPlayerPositionById(
      timelineEvents,
      extractPositionByPlayerName(pageDoc || logDoc)
    );
    const baseSnapshots = buildSnapshots(timelineEvents, state.teams, state.teamByPlayerId, state.playerPositionById);
    const sentenceTimeline = buildEventSentenceTimeline(timelineEvents, baseSnapshots);
    state.events = sentenceTimeline.events;
    state.snapshots = sentenceTimeline.snapshots;
    state.score = buildScore(state.events, state.teams);

    fillSummary();
    enableTimeline();
    document.body.classList.add("loaded");
    scheduleFieldLayoutRefresh();

    if (state.snapshots.length) {
      setCurrentIndex(0);
    } else {
      renderEventCard(null);
    }

    completeProgress(`Готово. Загружено ${events.length} событий, ${state.events.length} шагов${finalLogUrl ? ` из ${finalLogUrl}.` : "."}`);
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

wireAppEvents({
  closeEpisodeModal,
  closeEventListModal,
  elements,
  openEpisodeModal,
  openEventListModal,
  parseMatchPage,
  schedulePlayback,
  setCurrentIndex,
  state,
  stopPlayback
});

initializeApp({
  createFieldLabels,
  elements,
  parseMatchPage,
  refreshFieldLayout,
  renderEventCard,
  resizeField,
  updateButtons
});
