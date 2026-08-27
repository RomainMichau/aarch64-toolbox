// The outside opinion.
//
// tools.test.js's round-trip check asks whether decode(encode(row)) gives
// back row.name — which it does even when the row itself is wrong, because
// both directions read the same table. A wrong opcode value and a wrong
// mnemonic both survive it, and both shipped. So did a 300,000 word fuzz,
// for the same reason.
//
// These words are known from outside this repo: each one derived field by
// field from the A64 encoding, and most of them readable off any AArch64
// disassembly. Every finding this file was written for is in here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run } from "../docs/tools/index.js";
import { extractSendableAarch64 } from "../docs/tools/decode.js";

const { words } = JSON.parse(readFileSync(new URL("./known-words.json", import.meta.url)));

const instruction = (hex) =>
  run("aarch64-decode", { word: hex, read: "hex" }).fields.find((f) => f.label === "Instruction")?.value;

test("every known word decodes to the instruction it is", () => {
  for (const [hex, text, why] of words) {
    assert.equal(instruction(hex), text, `${hex}${why ? ` — ${why}` : ""}`);
  }
});

test("and encodes back to the word it came from", () => {
  for (const [hex, text] of words) {
    const res = run("aarch64-decode", { word: hex, read: "hex" });
    const sendable = extractSendableAarch64(res);
    assert.ok(sendable, `${hex} (${text}) is not fully known`);
    const encoded = run("aarch64-encode", sendable).fields;
    assert.equal(encoded.find((f) => f.label === "Hex")?.value, hex, `${text} re-encodes`);
    assert.equal(encoded.find((f) => f.label === "Instruction")?.value, text, `${text} reads the same in the encoder`);
  }
});
