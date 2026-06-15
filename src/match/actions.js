import { normalizeText } from "../utils/text.js";

export function normalizeActionLabel(action) {
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

export function getResultLabel(value) {
  if (value === true) return "Успех";
  if (value === false) return "Провал";
  if (value === "" || value === undefined) return "-";
  return String(value);
}

export function isPassAction(action) {
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

export function isShotAction(action) {
  return action === "удар"
    || action === "пенальти"
    || action === "medium_shot"
    || action === "long_shot"
    || action === "средний удар"
    || action === "дальний удар";
}

export function isSubstitutionAction(action) {
  return action === "замена";
}

export function isDribbleAction(action) {
  return action === "dribling"
    || action === "дриблинг";
}

export function isFoulAction(action) {
  return action === "нарушение"
    || action === "foul"
    || action === "violation";
}

export function getSnapshotAction(snapshot) {
  return String((snapshot && snapshot.event && snapshot.event.action) || "").toLowerCase();
}

export function isZeroLikeResult(result) {
  return result === 0
    || result === false
    || result === "0";
}

export function isFailedPassResult(result) {
  return isZeroLikeResult(result)
    || result === 7
    || result === "7";
}

export function samePlayer(leftPlayer, rightPlayer) {
  if (!leftPlayer || !rightPlayer) {
    return false;
  }

  if (leftPlayer.id && rightPlayer.id) {
    return leftPlayer.id === rightPlayer.id;
  }

  return normalizeText(leftPlayer.name) === normalizeText(rightPlayer.name);
}

export function isCornerKickNavesShotEvent(event) {
  return normalizeText(event && event.mixed_action).toLowerCase().includes("cornerkick_naves_shot");
}

export function isCornerKickNavesEvent(event) {
  return normalizeText(event && event.mixed_action).toLowerCase() === "cornerkick_naves";
}

export function isCornerPassEvent(event) {
  const action = String((event && event.action) || "").toLowerCase();
  return action === "corner_pass" || action === "угловой";
}

export function isNavesShotEvent(event) {
  const mixedAction = normalizeText(event && event.mixed_action).toLowerCase();
  return mixedAction === "naves_shot";
}

export function buildScore(events, teams) {
  const score = [0, 0];
  const home = normalizeText(teams[0]);
  const away = normalizeText(teams[1]);

  events.forEach((event) => {
    const team = normalizeText(event.team);
    if (!isGoalEvent(event)) {
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

export function isGoalEvent(event) {
  const action = String((event && event.action) || "").toLowerCase();
  return isShotAction(action) && (
    event.result === 1
    || event.result === true
    || event.result === "1"
  );
}

export function buildScoreUntilIndex(events, teams, endExclusive) {
  return buildScore(events.slice(0, Math.max(0, endExclusive)), teams);
}
