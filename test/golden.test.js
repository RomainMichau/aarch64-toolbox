// golden.json is a recorded corpus of inputs and their exact expected
// answers, covering the number converter isa-toolkit vendors unchanged into
// every sibling toolbox — the same corpus riscv_toolbox and
// turing_complete_toolbox both run, since the tool itself is identical here.
// It catches any regression the smaller, hand-written cases in
// tools.test.js happen to miss. The AArch64-specific coverage lives entirely
// in tools.test.js, since encode/decode results are new here, not reused.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { run } from "../docs/tools/index.js";

const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));

// A field with no format is recorded without the key, so drop it here too
// before comparing.
const strip = (fields) =>
  fields.map((f) => (f.format ? { label: f.label, value: f.value, format: f.format }
                              : { label: f.label, value: f.value }));

test(`every one of the ${golden.length} recorded cases still answers the same way`, () => {
  for (const { tool, inputs, expect } of golden) {
    const got = run(tool, inputs);
    assert.deepEqual(
      { error: got.error, fields: strip(got.fields) },
      expect,
      `${tool} ${JSON.stringify(inputs)}`,
    );
  }
});
