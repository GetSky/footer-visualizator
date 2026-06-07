const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sourcePath = path.join(rootDir, "visualizator.html");
const outputDir = path.join(rootDir, ".tmp");
const outputPath = path.join(outputDir, "visualizator.local.html");

const remoteBaseUrl = "https://getsky.github.io/footer-visualizator/";
const localBasePath = "../";

const html = fs.readFileSync(sourcePath, "utf8");

const moduleOrder = [
  "src/constants.js",
  "src/utils/text.js",
  "src/services/footter-loader.js",
  "src/parsers/players.js",
  "src/parsers/events.js",
  "src/field/geometry.js",
  "src/match/actions.js",
  "src/match/players.js",
  "src/match/teams.js",
  "src/match/snapshots.js",
  "src/app.js",
];

function toClassicScript(source) {
  return source
    .replace(/^import\s+[\s\S]*?;\r?\n/gm, "")
    .replace(/^export\s+/gm, "");
}

function buildLocalScript() {
  return moduleOrder
    .map((asset) => {
      const source = fs.readFileSync(path.join(rootDir, asset), "utf8");
      return `\n/* ${asset} */\n${toClassicScript(source).trimEnd()}\n`;
    })
    .join("\n");
}

if (!html.includes(remoteBaseUrl)) {
  throw new Error(`Expected ${sourcePath} to contain ${remoteBaseUrl}`);
}

const localScript = buildLocalScript();
const remoteScriptTag = `<script type="module" src="${remoteBaseUrl}src/app.js"></script>`;
const localScriptTag = `<script>\n${localScript}</script>`;

if (!html.includes(remoteScriptTag)) {
  throw new Error(`Expected ${sourcePath} to contain ${remoteScriptTag}`);
}

const localHtml = html
  .replaceAll(remoteBaseUrl, localBasePath)
  .replace(`<script type="module" src="${localBasePath}src/app.js"></script>`, localScriptTag);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, localHtml, "utf8");

console.log(`Generated ${path.relative(rootDir, outputPath)}`);
