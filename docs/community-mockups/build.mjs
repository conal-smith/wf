// Builds the review page from the real Force5 bundle, so the mockups cannot
// drift from the tokens and components they claim to use.
//   node docs/community-mockups/build.mjs
// Writes index.html (a full document, for a browser and for screenshots) and
// artifact.html (the same page as a fragment, for publishing).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const design = join(here, "../../design");
const read = (p) => readFileSync(p, "utf8");

// Light only: dark ships in the tokens but not in the product (principles.md, Gaps).
const tokens = read(join(design, "foundations/tokens.css"));
const light = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("@media (prefers-color-scheme: dark)"));

const components = ["surface", "button", "chip", "search-field", "segmented"]
  .map((c) => `/* design/${c}/component.css */\n${read(join(design, c, "component.css"))}`)
  .join("\n");

const reset = `*,*::before,*::after{box-sizing:border-box}button,input{font:inherit}`;
const css = [reset, light, components, read(join(here, "mockups.css"))].join("\n");
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap">`;
const head = `<title>Wingfoil Community Mockups</title>\n${fonts}\n<style>\n${css}\n</style>`;
const body = read(join(here, "body.html"));

writeFileSync(join(here, "artifact.html"), `${head}\n${body}\n`);
writeFileSync(
  join(here, "index.html"),
  `<!doctype html>\n<html lang="en-IE" data-mode="light">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`,
);
console.log("built index.html and artifact.html");
