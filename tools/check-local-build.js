const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const prodPath = path.join(rootDir, "visualizator.html");
const localPath = path.join(rootDir, ".tmp", "visualizator.local.html");
const remoteBaseUrl = "https://getsky.github.io/footer-visualizator/";

const htmlAssets = [
  "styles/base.css",
  "styles/layout.css",
  "styles/field.css",
  "styles/modals.css",
  "src/app.js",
];

const moduleAssets = [
  "src/constants.js",
  "src/utils/text.js",
  "src/services/footter-loader.js",
  "src/parsers/players.js",
  "src/parsers/events.js",
  "src/field/geometry.js",
  "src/ui/dom.js",
  "src/ui/progress.js",
  "src/ui/modals.js",
  "src/render/field-layout.js",
  "src/match/actions.js",
  "src/match/players.js",
  "src/match/teams.js",
  "src/match/snapshots.js",
];

const requiredAssets = [...htmlAssets, ...moduleAssets];

const prodHtml = fs.readFileSync(prodPath, "utf8");
const localHtml = fs.readFileSync(localPath, "utf8");

for (const asset of requiredAssets) {
  const assetPath = path.join(rootDir, asset);

  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing asset file: ${asset}`);
  }
}

for (const asset of htmlAssets) {
  if (!prodHtml.includes(`${remoteBaseUrl}${asset}`)) {
    throw new Error(`Production HTML does not reference remote asset: ${asset}`);
  }

  if (asset.endsWith(".css") && !localHtml.includes(`../${asset}`)) {
    throw new Error(`Local HTML does not reference local asset: ${asset}`);
  }
}

if (localHtml.includes(remoteBaseUrl)) {
  throw new Error("Local HTML still contains production asset base URL");
}

const appJs = fs.readFileSync(path.join(rootDir, "src", "app.js"), "utf8");

for (const asset of moduleAssets) {
  const importPath = asset.replace(/^src\//, "./");

  if (!appJs.includes(importPath) && !appJs.includes(importPath.replace(/^\.\//, "../"))) {
    throw new Error(`App module does not import asset: ${asset}`);
  }
}

if (localHtml.includes('type="module"') || localHtml.includes("../src/app.js")) {
  throw new Error("Local HTML must inline JavaScript for file:// module compatibility");
}

for (const asset of ["src/app.js", ...moduleAssets]) {
  if (!localHtml.includes(`/* ${asset} */`)) {
    throw new Error(`Local HTML does not include bundled script section: ${asset}`);
  }
}

for (const asset of ["src/app.js", ...moduleAssets]) {
  const source = fs.readFileSync(path.join(rootDir, asset), "utf8");

  childProcess.execFileSync(
    process.execPath,
    ["--input-type=module", "--check"],
    { input: source, stdio: ["pipe", "pipe", "pipe"] }
  );
}

console.log("Local visualizator build is valid");
