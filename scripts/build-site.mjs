// Builds the public website into dist/ (used by publish-site on Jarvis):
//   /            product website (site/)
//   /app/        the web app (web/)
//   /download/   the Android APK, taken from the "apk-latest" GitHub release that CI publishes
// Run: node scripts/build-site.mjs   (APK_URL overrides where the APK comes from)
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";

const REPO = "ER-VishalRana/varnum";
const APK_URL = process.env.APK_URL || `https://github.com/${REPO}/releases/download/apk-latest/varnum.apk`;
const INFO_URL = APK_URL.replace(/varnum\.apk$/, "version.json");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/download", { recursive: true });
cpSync("site", "dist", { recursive: true });
cpSync("web", "dist/app", { recursive: true });
rmSync("dist/app/README.md", { force: true });

async function get(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`download failed (${r.status}): ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

const apk = await get(APK_URL);
if (apk.length < 1_000_000 || apk.subarray(0, 2).toString() !== "PK") throw new Error("the downloaded APK does not look like an APK");
writeFileSync("dist/download/varnum.apk", apk);
let info = {};
try { info = JSON.parse((await get(INFO_URL)).toString()); } catch { /* older release without version.json */ }
const version = info.version || "1.0";
const size = (statSync("dist/download/varnum.apk").size / 1048576).toFixed(0) + " MB";
writeFileSync("dist/download/version.json", JSON.stringify({ version, size, ...info }, null, 2));

for (const page of ["dist/index.html"]) {
  writeFileSync(page, readFileSync(page, "utf8").replaceAll("{{APK_SIZE}}", size).replaceAll("{{APK_VERSION}}", version));
}
console.log(`dist/ built: website, app, APK ${version} (${size})`);
