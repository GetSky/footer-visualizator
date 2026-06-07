import { FIELD_COLS, FIELD_ROWS, START_COORD_FALLBACK } from "../constants.js";
import { normalizeText } from "../utils/text.js";

export function clampCoord(row, col) {
  const rawRow = Number(row);
  const rawCol = Number(col);
  const safeRow = Math.max(1, Math.min(FIELD_ROWS, Number.isFinite(rawRow) ? rawRow : START_COORD_FALLBACK[0]));
  const safeCol = Math.max(1, Math.min(FIELD_COLS, Number.isFinite(rawCol) ? rawCol : START_COORD_FALLBACK[1]));
  return [safeRow, safeCol];
}

export function getCoordsPair(event) {
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

export function getEventPoint(event) {
  const coords = Array.isArray(event.position) ? event.position : [];
  if (coords.length === 0) {
    return null;
  }

  return clampCoord(coords[0][0], coords[0][1]);
}

export function toGlobalCoord(coord, teamName, teams) {
  if (!coord) {
    return null;
  }

  return clampCoord(coord[0], coord[1]);
}

export function getPenaltySpot(teamName, teams) {
  const teamIndex = teams.indexOf(normalizeText(teamName));
  return teamIndex === 1 ? [2, 2.5] : [13, 2.5];
}

export function coordToPercent(row, col, options = {}) {
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

export function getShotGoalPoint(teamName, teams) {
  const isAway = teams.indexOf(normalizeText(teamName)) === 1;
  return [isAway ? 0.5 : FIELD_ROWS + 0.5, (FIELD_COLS + 1) / 2];
}

export function getCornerKickPasserPoint(snapshot, teams, sourcePoint = null) {
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

export function getCornerReceptionPoint(cornerPoint) {
  if (!cornerPoint) {
    return null;
  }

  return [
    cornerPoint[0] <= 1 ? 1 : FIELD_ROWS,
    cornerPoint[1] <= 1 ? 1 : FIELD_COLS
  ];
}
