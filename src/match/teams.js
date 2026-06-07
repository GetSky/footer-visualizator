import { parsePlayerValue } from "../parsers/players.js";
import { normalizeText } from "../utils/text.js";

export function getUniqueTeams(events) {
  return Array.from(new Set(events.map((event) => normalizeText(event.team)).filter(Boolean))).slice(0, 2);
}

export function extractTeamsFromMatchDoc(doc, events) {
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

export function inferTeamByPlayer(events, teams) {
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
