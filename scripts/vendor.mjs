#!/usr/bin/env node
// Copies the shared framework out of the isa-toolkit dependency into docs/,
// at the exact paths it already lives at there. No bundler, no transform —
// docs/ has to stay plain committed files for GitHub Pages to serve as-is.

import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = join(root, "node_modules", "isa-toolkit");
const docs = join(root, "docs");

const FILES = [
  "lib/bus.js",
  "lib/urlstate.js",
  "lib/bootstrap.js",
  "lib/hooks.mjs",
  "lib/html.js",
  "lib/htm.mjs",
  "lib/preact.mjs",
  "components/App.js",
  "components/bits.js",
  "components/palette.js",
  "components/Card.js",
  "components/Doc.js",
  "components/folds.js",
  "components/Inputs.js",
  "components/Results.js",
  "components/Segmented.js",
  "components/segments-dom.js",
  "tools/bits.js",
  "tools/number.js",
  "tools/run.js",
];

if (!existsSync(pkg)) {
  console.error("isa-toolkit is not installed — run npm install first.");
  process.exit(1);
}

for (const file of FILES) cpSync(join(pkg, file), join(docs, file));
console.log(`Vendored ${FILES.length} files from isa-toolkit into docs/.`);
