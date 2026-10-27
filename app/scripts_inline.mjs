// Post-build: inline the JS and CSS into one self-contained HTML file for private preview.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const dir = "dist/assets"; let html = readFileSync("dist/index.html", "utf8");
for (const f of readdirSync(dir)) {
  const body = readFileSync(`${dir}/${f}`, "utf8");
  if (f.endsWith(".js")) html = html.replace(new RegExp(`<script type="module" crossorigin src="./assets/${f}"></script>`), () => `<script type="module">${body.replace(/<\/script/g, "<\\/script")}</script>`);
  if (f.endsWith(".css")) html = html.replace(new RegExp(`<link rel="stylesheet" crossorigin href="./assets/${f}">`), () => `<style>${body}</style>`);
}
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error("asset not inlined");
writeFileSync(process.argv[2], html); console.log(process.argv[2], html.length);
