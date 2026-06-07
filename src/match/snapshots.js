import { FIELD_COLS, FIELD_ROWS, KICKOFF_POINT, START_COORD_FALLBACK } from "../constants.js";
import {
  isCornerKickNavesEvent,
  isCornerPassEvent,
  isFailedPassResult,
  isNavesShotEvent,
  isPassAction
} from "./actions.js";
import { parsePlayerValue } from "../parsers/players.js";
import { normalizeText } from "../utils/text.js";

function clampSnapshotCoord(row, col) {
  const rawRow = Number(row);
  const rawCol = Number(col);
  const safeRow = Math.max(1, Math.min(FIELD_ROWS, Number.isFinite(rawRow) ? rawRow : START_COORD_FALLBACK[0]));
  const safeCol = Math.max(1, Math.min(FIELD_COLS, Number.isFinite(rawCol) ? rawCol : START_COORD_FALLBACK[1]));
  return [safeRow, safeCol];
}

function getSnapshotCoordsPair(event) {
  const coords = Array.isArray(event.position) ? event.position : [];
  if (coords.length >= 2) {
    return {
      from: clampSnapshotCoord(coords[0][0], coords[0][1]),
      to: clampSnapshotCoord(coords[1][0], coords[1][1])
    };
  }

  if (coords.length === 1) {
    const point = clampSnapshotCoord(coords[0][0], coords[0][1]);
    return { from: point, to: point };
  }

  return { from: null, to: null };
}

function getSnapshotEventPoint(event) {
  const coords = Array.isArray(event.position) ? event.position : [];
  if (coords.length === 0) {
    return null;
  }

  return clampSnapshotCoord(coords[0][0], coords[0][1]);
}

function getSnapshotPlayerMarkerLabel(player, playerPositionById) {
  if (player && player.id && playerPositionById[player.id]) {
    return playerPositionById[player.id];
  }

  const name = player && player.name ? player.name : "";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").slice(0, 2).toUpperCase() || "P";
}

function makeSnapshotPlayerState(player, team, row, col, role, index, fallbackColor, playerPositionById) {
  return {
    id: player ? player.id : `${role}_${index}`,
    name: player ? player.name : role,
    markerLabel: getSnapshotPlayerMarkerLabel(player, playerPositionById),
    team: team || fallbackColor,
    row,
    col,
    role,
    active: true
  };
}

function getSnapshotPenaltySpot(teamName, teams) {
  const teamIndex = teams.indexOf(normalizeText(teamName));
  return teamIndex === 1 ? [2, 2.5] : [13, 2.5];
}

function cloneSnapshotPlayersById(playersById) {
  const clone = {};
  Object.keys(playersById).forEach((playerId) => {
    clone[playerId] = { ...playersById[playerId] };
  });
  return clone;
}

function getSnapshotOtherTeam(teamName, teams) {
  return teams.find((item) => item !== teamName) || teamName;
}

function getSnapshotCornerKickPasserPoint(snapshot, teams, sourcePoint = null) {
  const shotPoint = sourcePoint || (snapshot && snapshot.focusPoint ? snapshot.focusPoint : START_COORD_FALLBACK);
  const teamName = normalizeText(snapshot && snapshot.event && snapshot.event.team);
  const teamIndex = teams.indexOf(teamName);
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

function getSnapshotCornerReceptionPoint(cornerPoint) {
  if (!cornerPoint) {
    return null;
  }

  return [
    cornerPoint[0] <= 1 ? 1 : FIELD_ROWS,
    cornerPoint[1] <= 1 ? 1 : FIELD_COLS
  ];
}

export function buildSnapshots(events, teams, teamByPlayerId, playerPositionById = {}) {
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
    const localPoint = getSnapshotEventPoint(event);
    const nextEvent = events[index + 1] || null;
    const nextLocalPoint = nextEvent ? getSnapshotEventPoint(nextEvent) : null;
    const previousFocusPoint = snapshots.length ? snapshots[snapshots.length - 1].focusPoint : null;
    const kickoffPoint = nextLocalPoint ? clampSnapshotCoord(nextLocalPoint[0], nextLocalPoint[1]) : null;
    const coordsPair = getSnapshotCoordsPair(event);
    let currentPoint = isKickoff
      ? (kickoffPoint || KICKOFF_POINT)
      : (
        isPenalty
          ? getSnapshotPenaltySpot(team, teams)
          : (localPoint || START_COORD_FALLBACK)
      );

    if (isCornerKickNavesEvent(event)) {
      currentPoint = getSnapshotCornerKickPasserPoint({ event }, teams, coordsPair.to || localPoint || currentPoint);
    } else if (isCornerPassEvent(event) && !localPoint) {
      currentPoint = getSnapshotCornerKickPasserPoint({ event }, teams, previousFocusPoint || currentPoint);
    }
    const previousPlayersById = cloneSnapshotPlayersById(knownPlayersById);

    if (actor) {
      const actorState = makeSnapshotPlayerState(actor, actorTeam, currentPoint[0], currentPoint[1], "ball", event.index, defaultTeams.home, playerPositionById);
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
      knownPlayersById[target.id] = makeSnapshotPlayerState(target, targetTeam, targetPoint[0], targetPoint[1], "target", event.index, targetTeam, playerPositionById);
    }

    if (opponent && opponent.id && isCornerKickNavesEvent(event) && nextLocalPoint) {
      const opponentTeam = teamByPlayerId[opponent.id] || getSnapshotOtherTeam(team, teams);
      knownPlayersById[opponent.id] = makeSnapshotPlayerState(opponent, opponentTeam, nextLocalPoint[0], nextLocalPoint[1], "opponent", event.index, opponentTeam, playerPositionById);
    }

    if (target && target.id && isCornerPassEvent(event) && isNavesShotEvent(nextEvent)) {
      const targetTeam = teamByPlayerId[target.id] || team;
      const targetPoint = getSnapshotCornerReceptionPoint(currentPoint) || currentPoint;
      knownPlayersById[target.id] = makeSnapshotPlayerState(target, targetTeam, targetPoint[0], targetPoint[1], "target", event.index, targetTeam, playerPositionById);
    }

    if (opponent && opponent.id && coordsPair.to && isFailedPassResult(event.result)) {
      const opponentTeam = teamByPlayerId[opponent.id] || getSnapshotOtherTeam(team, teams);
      knownPlayersById[opponent.id] = makeSnapshotPlayerState(opponent, opponentTeam, coordsPair.to[0], coordsPair.to[1], "opponent", event.index, opponentTeam, playerPositionById);
    }

    snapshots.push({
      event,
      players: framePlayers,
      playersById: cloneSnapshotPlayersById(knownPlayersById),
      previousPlayersById,
      focusPoint: currentPoint
    });
  }

  return snapshots;
}
