const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const sourcePath = path.join(rootDir, "visualizator.html");
const outputDir = path.join(rootDir, ".tmp");
const outputPath = path.join(outputDir, "visualizator.local.html");

const remoteBaseUrl = "https://getsky.github.io/footer-visualizator/";
const localBasePath = "../";

const html = fs.readFileSync(sourcePath, "utf8");

if (!html.includes(remoteBaseUrl)) {
  throw new Error(`Expected ${sourcePath} to contain ${remoteBaseUrl}`);
}

const localHtml = html.replaceAll(remoteBaseUrl, localBasePath);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, localHtml, "utf8");

console.log(`Generated ${path.relative(rootDir, outputPath)}`);
