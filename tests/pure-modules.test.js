import test from "node:test";
import assert from "node:assert/strict";

import { getMatchUrlFromQuery, normalizeMatchQueryValue } from "../src/app/query.js";
import { clampCoord, coordToPercent, getCoordsPair, getCornerKickPasserPoint } from "../src/field/geometry.js";
import { buildScore, buildScoreUntilIndex } from "../src/match/actions.js";
import { buildPlayerInfoById, buildPlayerPositionById } from "../src/match/players.js";
import { buildSnapshots } from "../src/match/snapshots.js";
import { inferTeamByPlayer } from "../src/match/teams.js";
import { coerceValue, parsePositionValue, parsePrevPassValue } from "../src/parsers/events.js";
import { parseNamedIdReference, parsePlayerIdReference, parsePlayerValue } from "../src/parsers/players.js";
import { normalizeText, slugifyKey, toAbsoluteUrl } from "../src/utils/text.js";

const teams = ["Home", "Away"];

function makeEvents() {
  return [
    {
      index: 0,
      team: "Home",
      action: "pass",
      player_with_ball: "10 Alice Smith",
      target: "9 Bob Jones",
      opponent: "5 Carol Block",
      position: [[7, 2], [8, 3]],
      result: true
    },
    {
      index: 1,
      team: "Home",
      action: "medium_shot",
      player_with_ball: "9 Bob Jones",
      opponent: "1 Dan Keeper",
      position: [[12, 2]],
      result: 1
    },
    {
      index: 2,
      team: "Away",
      action: "medium_shot",
      player_with_ball: "11 Eve Forward",
      opponent: "1 Home Keeper",
      position: [[3, 2]],
      result: 0
    }
  ];
}

test("text utilities normalize values and build stable URLs", () => {
  assert.equal(normalizeText("  first\u00a0 value\n\n\nsecond\tvalue  "), "first value\n\nsecond value");
  assert.equal(slugifyKey(" Player: 10 / Target ", "fallback"), "player_10_target");
  assert.equal(slugifyKey("!!!", "fallback"), "fallback");
  assert.equal(toAbsoluteUrl("/match_log/305506/", "https://footter.com/match/305506/"), "https://footter.com/match_log/305506/");
});

test("query parameters support full URLs and match ids", () => {
  assert.equal(normalizeMatchQueryValue(" 305506 "), "https://footter.com/match/305506/");
  assert.equal(getMatchUrlFromQuery("?match=305506"), "https://footter.com/match/305506/");
  assert.equal(getMatchUrlFromQuery("?match_url=https%3A%2F%2Fexample.test%2Fmatch%2F1%2F"), "https://example.test/match/1/");
  assert.equal(getMatchUrlFromQuery("?url=https%3A%2F%2Fexample.test%2Fmatch%2F2%2F&match=305506"), "https://example.test/match/2/");
  assert.equal(getMatchUrlFromQuery("?other=1"), "");
});

test("event parsers coerce positions, results, and previous pass data", () => {
  assert.deepEqual(parsePositionValue("[(1, 2), (14, 4)]"), [[1, 2], [14, 4]]);
  assert.deepEqual(parsePrevPassValue("{'pm': 42, 'coord': [[3, 1], [4, 2]]}"), {
    pm: "42",
    coords: [[3, 1], [4, 2]]
  });
  assert.equal(coerceValue("time", "15"), 15);
  assert.equal(coerceValue("result", "True"), true);
  assert.equal(coerceValue("result", "0"), 0);
  assert.deepEqual(coerceValue("position", "[[2, 3]]"), [[2, 3]]);
});

test("player parsers extract ids without losing labels", () => {
  assert.deepEqual(parsePlayerValue("10 Alice Smith"), {
    id: "10",
    name: "Alice Smith",
    label: "10 Alice Smith"
  });
  assert.deepEqual(parsePlayerValue("Bench Player"), {
    id: null,
    name: "Bench Player",
    label: "Bench Player"
  });
  assert.equal(parsePlayerIdReference("player_id: 25"), "25");
  assert.equal(parsePlayerIdReference("None"), "");
  assert.equal(parseNamedIdReference("target: 9, opponent: 5", "target"), "9");
});

test("scoring counts only successful shot actions by team", () => {
  const events = makeEvents();

  assert.deepEqual(buildScore(events, teams), [1, 0]);
  assert.deepEqual(buildScoreUntilIndex(events, teams, 1), [0, 0]);
  assert.deepEqual(buildScoreUntilIndex(events, teams, 2), [1, 0]);
});

test("team and player maps are inferred from event participants", () => {
  const events = makeEvents();
  const teamByPlayer = inferTeamByPlayer(events, teams);
  const playerById = buildPlayerInfoById(events);
  const positionById = buildPlayerPositionById(events, {
    "alice smith": "CM",
    "bob jones": "CF"
  });

  assert.equal(teamByPlayer["10"], "Home");
  assert.equal(teamByPlayer["9"], "Home");
  assert.equal(teamByPlayer["5"], "Away");
  assert.equal(playerById["10"].name, "Alice Smith");
  assert.deepEqual(positionById, { "10": "CM", "9": "CF" });
});

test("snapshots keep current and known player positions", () => {
  const events = makeEvents();
  const teamByPlayer = inferTeamByPlayer(events, teams);
  const snapshots = buildSnapshots(events, teams, teamByPlayer, {
    "10": "CM",
    "9": "CF"
  });

  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots[0].focusPoint, [7, 2]);
  assert.equal(snapshots[0].playersById["10"].markerLabel, "CM");
  assert.equal(snapshots[0].playersById["9"].role, "target");
  assert.deepEqual([snapshots[0].playersById["9"].row, snapshots[0].playersById["9"].col], [8, 3]);
  assert.equal(snapshots[1].previousPlayersById["10"].name, "Alice Smith");
});

test("field geometry clamps coordinates and maps special points", () => {
  assert.deepEqual(clampCoord(99, -3), [14, 1]);
  assert.deepEqual(getCoordsPair({ position: [[1, 1], [20, 7]] }), {
    from: [1, 1],
    to: [14, 4]
  });
  assert.deepEqual(coordToPercent(1, 1), {
    x: (0.5 / 14) * 100,
    y: (0.5 / 4) * 100
  });
  assert.deepEqual(getCornerKickPasserPoint({ event: { team: "Home" } }, teams, [13, 4]), [14.5, 4.5]);
});
