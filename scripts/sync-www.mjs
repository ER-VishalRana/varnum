// Builds www/ (the Android app's web files) from web/ (the website), so the app always matches the site.
// The app loads its libraries from www/lib instead of a CDN, and has no service worker.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from "node:fs";

const LIBS = {
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js": "lib/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": "lib/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js": "lib/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js": "lib/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js": "lib/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js": "lib/qrcode.min.js",
};
const COPY = ["auth.js", "logo.svg", "favicon-32.png", "logo-96.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "ui-hi.js", "tools.js", "sheet.js", "manifest.webmanifest"];

let html = readFileSync("web/index.html", "utf8");
for (const [cdn, local] of Object.entries(LIBS)) {
  if (!html.includes(cdn)) throw new Error("web/index.html no longer loads " + cdn);
  html = html.split(cdn).join(local);
}
html = html.replace(/<script src="auth\.js[^"]*">/, '<script src="auth.js">');
html = html.replace(/<link rel="canonical"[^>]*>\n?/, "");
mkdirSync("www", { recursive: true });
for (const f of ["index.html", ...COPY]) if (existsSync("www/" + f)) rmSync("www/" + f);
writeFileSync("www/index.html", html);
for (const f of COPY) copyFileSync("web/" + f, "www/" + f);
// tools.js and sheet.js load some libraries on demand; point those at www/lib too.
for (const f of ["tools.js", "sheet.js"]) {
  let js = readFileSync("www/" + f, "utf8");
  for (const [cdn, local] of Object.entries(LIBS)) js = js.split(cdn).join(local);
  writeFileSync("www/" + f, js);
}
for (const local of Object.values(LIBS)) if (!existsSync("www/" + local)) throw new Error("missing www/" + local);
console.log("www/ updated from web/");
