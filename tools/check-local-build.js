const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const prodPath = path.join(rootDir, "visualizator.html");
const localPath = path.join(rootDir, ".tmp", "visualizator.local.html");
const remoteBaseUrl = "https://getsky.github.io/footer-visualizator/";

const requiredAssets = [
  "styles/base.css",
  "styles/layout.css",
  "styles/field.css",
  "styles/modals.css",
  "src/app.js",
];

const prodHtml = fs.readFileSync(prodPath, "utf8");
const localHtml = fs.readFileSync(localPath, "utf8");

for (const asset of requiredAssets) {
  const assetPath = path.join(rootDir, asset);

  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing asset file: ${asset}`);
  }

  if (!prodHtml.includes(`${remoteBaseUrl}${asset}`)) {
    throw new Error(`Production HTML does not reference remote asset: ${asset}`);
  }

  if (!localHtml.includes(`../${asset}`)) {
    throw new Error(`Local HTML does not reference local asset: ${asset}`);
  }
}

if (localHtml.includes(remoteBaseUrl)) {
  throw new Error("Local HTML still contains production asset base URL");
}

const appJs = fs.readFileSync(path.join(rootDir, "src", "app.js"), "utf8");
new Function(appJs);

console.log("Local visualizator build is valid");
