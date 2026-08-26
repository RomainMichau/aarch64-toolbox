#!/usr/bin/env node
// Writes the static reference pages, the sitemap and robots.txt from the very
// same tool descriptors registry.js hands the running page — see
// isa-toolkit's generate/reference.mjs for what comes out and why. Runs after
// vendor.mjs, since it reads a registry that imports vendored modules.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReference } from "isa-toolkit/generate/reference.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docs = join(root, "docs");
const { TOOLS } = await import(new URL("../docs/registry.js", import.meta.url));

const written = writeReference({
  tools: TOOLS,
  outDir: docs,
  site: {
    name: "AArch64 Toolbox",
    short: "AArch64",
    base: "https://romainmichau.github.io/aarch64-toolbox/",
    root: "../", // every generated page sits one level down, in reference/
    tagline: "AArch64 (ARM64) A64 encoding reference: the integer core and atomics, class by class, alongside a browser encoder and decoder.",
  },
});

console.log(`Wrote ${written.length} reference pages, a sitemap and robots.txt into docs/.`);
