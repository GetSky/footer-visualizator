import { parsePlayerValue } from "../parsers/players.js";
import { normalizeText } from "../utils/text.js";

export function isFootballPosition(value) {
  return /^(GK|LD|CD|RD|LWB|DM|RWB|LM|CM|RM|LW|AM|RW|CF)$/i.test(normalizeText(value));
}

export function normalizePlayerNameKey(value) {
  return normalizeText(value).toLowerCase();
}

export function extractPositionByPlayerName(doc) {
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

export function collectEventPlayers(event) {
  return [
    parsePlayerValue(event.player_with_ball),
    parsePlayerValue(event.target),
    parsePlayerValue(event.opponent)
  ].filter(Boolean);
}

export function buildPlayerInfoById(events) {
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

export function buildPlayerPositionById(events, positionByPlayerName) {
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

export function makeDisplayName(player) {
  return player ? player.name : "-";
}
