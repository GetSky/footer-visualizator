import { FOOTTER_PROXY_MATCH_URL } from "../constants.js";
import { normalizeText, toAbsoluteUrl } from "../utils/text.js";

export function extractMatchLogUrl(doc, pageUrl) {
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

export async function fetchText(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

export async function fetchWithFallbacks(url) {
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

export async function fetchCandidateText(candidate) {
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

export function buildHostedRemoteFetchMessage(errorMessage) {
  const isFileProtocol = window.location.protocol === "file:";
  const isHostedApp = !isFileProtocol && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname || "");
  const hint = isFileProtocol
    ? "Страница открыта как file://, и браузер блокирует прямой fetch на footter."
    : (isHostedApp
      ? "На домене direct-fetch упирается в CORS. В этом режиме основная надежда - `getsky.tech/footter_proxy_match`, а публичные CORS-прокси идут только как fallback."
      : "Прямой fetch на footter может быть заблокирован CORS-политикой или прокси не доступен.");
  return `Не удалось загрузить страницу по ссылке. ${hint} Самый надежный вариант: загрузить сохраненный HTML матча или match_log. ${errorMessage}`;
}

export function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

export async function readFileText(file) {
  if (!file) {
    return "";
  }
  return file.text();
}
