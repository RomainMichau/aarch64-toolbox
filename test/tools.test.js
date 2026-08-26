// A readable pass over the behaviour the README promises. The exhaustive
// checking of the number converter lives in golden.json/golden.test.js; the
// instruction cases here are hand-checked against known AArch64 encodings
// (objdump-style output for `add x1,x2,x3`, `movz x0,#0x1234`, and so on —
// see aarch64.js's CLASSES comments for the specific words each layout was
// checked against) and against the architecture's own DecodeBitMasks
// algorithm for the logical immediate.

import test from "node:test";
import assert from "node:assert/strict";

import { run } from "../docs/tools/index.js";
import * as a from "../docs/tools/aarch64.js";

const bits = (n, width) => (n >>> 0).toString(2).padStart(width, "0");

const values = (id, inputs) =>
  Object.fromEntries(run(id, inputs).fields.map((f) => [f.label, f.value]));

// enc fills the boxes a class's layout calls for. fields is { id: number },
// class is added automatically from cls.
const enc = (cls, fields) => {
  const idx = a.CLASS_KEYS.indexOf(cls);
  const input = { class: bits(idx, 4) };
  for (const [id, spec] of a.layout(cls)) input[id] = bits(fields[id] ?? 0, spec.width);
  return values("aarch64-encode", input);
};

const dec = (word, read = "hex") => values("aarch64-decode", { word, read });

test("the number converter is reachable through this toolbox too", () => {
  assert.equal(values("number", { value: "205" })["Read as"], "decimal, 8 bits (1 byte)");
});

test("a half typed value is not an error", () => {
  assert.deepEqual(run("number", { value: "" }), { fields: [], error: "" });
  assert.deepEqual(run("aarch64-decode", { word: "", read: "bits" }), { fields: [], error: "" });
});

// --- Encoder: one valid case per class in scope ----------------------------

test("B / BL", () => {
  const b = enc("b_bl", { opc: 0b000101, imm26: 4 }); // 4 words = 16 bytes forward
  assert.equal(b.Hex, "0x14000004");
  assert.equal(b.Instruction, "b #16");
  assert.equal(b.Effect, "pc = pc + 16");

  const bl = enc("b_bl", { opc: 0b100101, imm26: (1 << 26) - 4 }); // -4 words = -16 bytes
  assert.equal(bl.Hex, "0x97FFFFFC");
  assert.equal(bl.Instruction, "bl #-16");
  assert.equal(bl.Effect, "x30 = pc + 4; pc = pc + -16");
});

test("B.cond", () => {
  const got = enc("b_cond", { opc: 0b01010100, imm19: 8, cond: 0b0001 }); // ne
  assert.equal(got.Hex, "0x54000101");
  assert.equal(got.Instruction, "b.ne #32");
  assert.equal(got.Effect, "if (Z == 0) pc = pc + 32");
});

test("CBZ / CBNZ", () => {
  const cbz = enc("cbz_cbnz", { sf: 0, opc: 0b0110100, imm19: 2, rt: 5 });
  assert.equal(cbz.Hex, "0x34000045");
  assert.equal(cbz.Instruction, "cbz w5, #8");
  assert.equal(cbz.Effect, "if (w5 == 0) pc = pc + 8");

  const cbnz = enc("cbz_cbnz", { sf: 1, opc: 0b0110101, imm19: 0, rt: 0 });
  assert.equal(cbnz.Instruction, "cbnz x0, #0");
});

test("ADD / SUB (immediate) — round trips through sp", () => {
  const add = enc("addsub_imm", { sf: 1, opc: 0b00100010, sh: 0, imm12: 16, rn: 31, rd: 0 });
  assert.equal(add.Instruction, "add x0, sp, #16");
  assert.equal(add.Effect, "x0 = sp + 16");

  const sub = enc("addsub_imm", { sf: 1, opc: 0b10100010, sh: 1, imm12: 1, rn: 0, rd: 0 });
  assert.equal(sub.Instruction, "sub x0, x0, #4096");
  assert.equal(sub.Effect, "x0 = x0 - 4096");
});

test("AND / ORR / EOR (immediate) — the bitmask immediate decodes to its real value", () => {
  // N=0, immr=0, imms=0, 32 bit: a single 1 bit, per DecodeBitMasks.
  const got = enc("logical_imm", { sf: 0, opc: 0b01100100, n: 0, immr: 0, imms: 0, rn: 1, rd: 0 });
  assert.equal(got.Hex, "0x32000020");
  assert.equal(got.Instruction, "orr w0, w1, #0x1");
  assert.equal(got.Effect, "w0 = w1 | 0x1");
});

test("MOVZ / MOVN / MOVK", () => {
  const z = enc("movewide", { sf: 1, opc: 0b10100101, hw: 0, imm16: 0x1234, rd: 0 });
  assert.equal(z.Hex, "0xD2824680");
  assert.equal(z.Instruction, "movz x0, #0x1234");
  assert.equal(z.Effect, "x0 = 0x1234");

  const zShifted = enc("movewide", { sf: 1, opc: 0b10100101, hw: 1, imm16: 0x1234, rd: 0 });
  assert.equal(zShifted.Instruction, "movz x0, #0x1234, lsl #16");
  assert.equal(zShifted.Effect, "x0 = 0x12340000");

  const n = enc("movewide", { sf: 1, opc: 0b00100101, hw: 0, imm16: 0, rd: 0 });
  assert.equal(n.Instruction, "movn x0, #0x0");
  assert.equal(n.Effect, "x0 = NOT(0x0 << 0) = 0xFFFFFFFFFFFFFFFF");

  const k = enc("movewide", { sf: 0, opc: 0b11100101, hw: 1, imm16: 0xBEEF, rd: 3 });
  assert.equal(k.Instruction, "movk w3, #0xBEEF, lsl #16");
  assert.equal(k.Effect, "w3[31:16] = 0xBEEF, the rest of w3 unchanged");
});

test("ADD / SUB (register)", () => {
  const got = enc("addsub_reg", { sf: 1, opc: 0b0001011, shiftop: 0, rm: 2, imm6: 0, rn: 1, rd: 0 });
  assert.equal(got.Hex, "0x8B020020");
  assert.equal(got.Instruction, "add x0, x1, x2");
  assert.equal(got.Effect, "x0 = x1 + x2");

  const shifted = enc("addsub_reg", { sf: 1, opc: 0b1001011, shiftop: 0b010, rm: 2, imm6: 4, rn: 1, rd: 0 });
  assert.equal(shifted.Instruction, "sub x0, x1, x2, lsr #4");
  assert.equal(shifted.Effect, "x0 = x1 - lsr(x2, 4)");
});

test("AND / ORR / EOR (register) — mov is orr with no shift and xzr", () => {
  const got = enc("logical_reg", { sf: 1, opc: 0b0101010, shift: 0, n: 0, rm: 1, imm6: 0, rn: 31, rd: 0 });
  assert.equal(got.Hex, "0xAA0103E0");
  assert.equal(got.Instruction, "orr x0, xzr, x1");
});

test("LDR / STR (immediate) at all four sizes", () => {
  assert.equal(enc("ldst_imm", { size: 0b00, opc: 0b11100100, imm12: 0, rn: 1, rt: 0 }).Instruction, "strb w0, [x1]");
  assert.equal(enc("ldst_imm", { size: 0b01, opc: 0b11100101, imm12: 2, rn: 1, rt: 0 }).Instruction, "ldrh w0, [x1, #4]");
  assert.equal(enc("ldst_imm", { size: 0b10, opc: 0b11100100, imm12: 1, rn: 2, rt: 3 }).Instruction, "str w3, [x2, #4]");
  const x = enc("ldst_imm", { size: 0b11, opc: 0b11100101, imm12: 1, rn: 1, rt: 0 });
  assert.equal(x.Hex, "0xF9400420");
  assert.equal(x.Instruction, "ldr x0, [x1, #8]");
});

// --- Encoder: things outside the declared scope classify but do not name ---

test("ADDS/SUBS (S=1) and ANDS (opc=11) classify but are not instructions in scope", () => {
  const adds = enc("addsub_imm", { sf: 1, opc: 0b01100010, sh: 0, imm12: 1, rn: 0, rd: 0 });
  assert.equal(adds.Class, "ADD/SUB (immediate)");
  assert.equal(adds.Instruction, "no instruction in scope has these fields");

  const ands = enc("logical_imm", { sf: 1, opc: 0b11100100, n: 0, immr: 0, imms: 0, rn: 0, rd: 0 });
  assert.equal(ands.Class, "AND/ORR/EOR (immediate)");
  assert.equal(ands.Instruction, "no instruction in scope has these fields");
});

test("the extended-register add/sub form shares addsub_reg's marker but is out of scope", () => {
  const got = enc("addsub_reg", { sf: 1, opc: 0b0001011, shiftop: 0b001, rm: 1, imm6: 0, rn: 0, rd: 0 });
  assert.equal(got.Class, "ADD/SUB (register)");
  assert.equal(got.Instruction, "no instruction in scope has these fields");
});

test("N=1 on the logical register form is BIC/ORN/EON, out of scope", () => {
  const got = enc("logical_reg", { sf: 1, opc: 0b0001010, shift: 0, n: 1, rm: 1, imm6: 0, rn: 0, rd: 0 });
  assert.equal(got.Instruction, "no instruction in scope has these fields");
});

test("a reserved bitmask immediate reports why, not a wrong value", () => {
  // imms == levels (here imms = 31 = levels for a 32 bit element) is reserved
  // per DecodeBitMasks — a valid-looking N/immr/imms that names no real
  // immediate, so it surfaces as a field explaining why, the same way an
  // unrecognised opcode does, not as a thrown, red "error".
  const got = enc("logical_imm", { sf: 0, opc: 0b00100100, n: 0, immr: 0, imms: 0b011111, rn: 0, rd: 0 });
  assert.match(got.Immediate, /reserved/);
});

test("a class outside 0-8 says so", () => {
  const got = values("aarch64-encode", { class: bits(12, 4) });
  assert.equal(got.Class, "12 is not a class this toolbox knows — pick 0-8");
});

// --- Encoder: field-width overflow and non-binary input --------------------

test("field-width overflow throws a clear error", () => {
  const got = run("aarch64-encode", {
    class: bits(a.CLASS_KEYS.indexOf("addsub_imm"), 4),
    sf: "1", opc: bits(0b00100010, 8), sh: "0", imm12: "1".repeat(13), rn: bits(0, 5), rd: bits(0, 5),
  });
  assert.equal(got.error, "imm12: 13 bits given, field is 12 bits wide");
});

test("non-binary characters in a field throw", () => {
  const got = run("aarch64-encode", {
    class: bits(a.CLASS_KEYS.indexOf("addsub_reg"), 4),
    sf: "1", opc: bits(0b0001011, 7), shiftop: "2ab", rm: bits(0, 5), imm6: bits(0, 6), rn: bits(0, 5), rd: bits(0, 5),
  });
  assert.match(got.error, /shiftop: "2ab" is not a binary value/);
});

// --- Decoder: "Bits" mode ---------------------------------------------------

test("Bits mode reads a plain bit pattern", () => {
  const pattern = (0x8B020020).toString(2).padStart(32, "0");
  const got = dec(pattern, "bits");
  assert.equal(got.Instruction, "add x0, x1, x2");
});

test("Bits mode reads a pattern with letters standing in for unknown bits", () => {
  // add rd, rn, rm as a table pattern, registers left as variables.
  const got = values("aarch64-decode", {
    word: "10001011000" + "mmmmm" + "000000" + "nnnnn" + "ddddd",
    read: "bits",
  });
  assert.equal(got.rm, "variable m");
  assert.equal(got.rn, "variable n");
  assert.equal(got.rd, "variable d");
  assert.equal(got.Instruction, "add variable d, variable n, variable m");
});

test("a 0x/0b/0o prefix reads as a number even when the toggle is left on Bits", () => {
  const got = values("aarch64-decode", { word: "0x8B020020", read: "bits" });
  assert.equal(got.Instruction, "add x0, x1, x2");
});

test("invalid characters in Bits mode are pointed at by position", () => {
  const got = run("aarch64-decode", { word: "0000!!!!" + "0".repeat(24), read: "bits" });
  assert.equal(got.error, `"!" at position 5 is neither a bit nor a variable`);
});

test("a short Bits pattern is read as the low bits of the word", () => {
  const got = values("aarch64-decode", { word: "101", read: "bits" });
  assert.equal(got.Bits, "0".repeat(29) + "101");
});

// --- Decoder: "Number" mode -------------------------------------------------

test("Number mode reads a decimal value", () => {
  const got = values("aarch64-decode", { word: String(0x8B020020), read: "number" });
  assert.equal(got.Instruction, "add x0, x1, x2");
});

test("Number mode rejects a value that overflows the word", () => {
  const got = run("aarch64-decode", { word: String(2 ** 32), read: "number" });
  assert.match(got.error, /does not fit in a 32 bit word/);
});

test("an empty or invalid Number input is not an error, or is a clear one", () => {
  assert.deepEqual(run("aarch64-decode", { word: "", read: "number" }), { fields: [], error: "" });
  assert.match(run("aarch64-decode", { word: "not-a-number", read: "number" }).error, /is not a number/);
});

// --- Decoder: "Hex" mode ----------------------------------------------------

test("Hex mode reads bare hex digits, no 0x required, and tolerates a redundant one", () => {
  assert.equal(values("aarch64-decode", { word: "8B020020", read: "hex" }).Instruction, "add x0, x1, x2");
  assert.equal(values("aarch64-decode", { word: "0x8B020020", read: "hex" }).Instruction, "add x0, x1, x2");
});

test("Hex mode rejects a non-hex character with the same message Number mode's example uses", () => {
  const got = run("aarch64-decode", { word: "00G0" + "0".repeat(28), read: "hex" });
  assert.match(got.error, /is not a hex number/);
});

// --- Decoder: classifying a word whose fixed bits are not fully known ------

test("a word cannot be classified until enough of its fixed bits are known", () => {
  // Every marker bit unknown: cannot even say whether classification failed
  // outright or is just not yet possible.
  const blocked = values("aarch64-decode", { word: "x".repeat(32), read: "bits" });
  assert.match(blocked.Class, /needs more of the word's fixed marker bits/);
  assert.equal(blocked.Instruction, "needs the class to be known");
});

test("a fully known word that matches no class in scope says so plainly", () => {
  // 11111111... matches no class's marker at any of the tried positions.
  const got = values("aarch64-decode", { word: "1".repeat(32), read: "bits" });
  assert.equal(got.Class, "no class in scope matches these bits");
});

test("a classified word whose selector bits are still unknown says what it needs", () => {
  // addsub_reg's marker (bits 28:24 = 01011) is known, but opc also carries
  // op/S (bits 30:29), left as variables here — so the class is clear but
  // which instruction it is is not, yet.
  const word = "s" + "oo01011" + "000" + "00010" + "000000" + "00001" + "00000";
  assert.equal(word.length, 32);
  const got = values("aarch64-decode", { word, read: "bits" });
  assert.equal(got.Class, "ADD/SUB (register)");
  assert.match(got.Instruction, /needs opc to be known/);
});

// --- Decoder -> encoder handoff --------------------------------------------

test("extractSendable is null while the word still has unknown bits", async () => {
  const { extractSendableAarch64 } = await import("../docs/tools/decode.js");
  // add ?, ?, x2 — sf/opc/shiftop/rm/imm6 (22 bits) known, rn and rd (10 bits) not.
  const word = "1" + bits(0b0001011, 7) + "000" + bits(2, 5) + bits(0, 6) + "nnnnn" + "ddddd";
  assert.equal(word.length, 32);
  const res = run("aarch64-decode", { word, read: "bits" });
  assert.equal(extractSendableAarch64(res), null);
});

test("extractSendable returns the class and fields once the word is fully known, and re-encoding it gives back the same word", async () => {
  const { extractSendableAarch64 } = await import("../docs/tools/decode.js");
  const res = run("aarch64-decode", { word: "0x8B020020", read: "hex" });
  const sendable = extractSendableAarch64(res);
  assert.ok(sendable);
  assert.equal(sendable.class, bits(a.CLASS_KEYS.indexOf("addsub_reg"), 4));

  const reEncoded = values("aarch64-encode", sendable);
  assert.equal(reEncoded.Hex, "0x8B020020");
  assert.equal(reEncoded.Instruction, "add x0, x1, x2");
});

// --- Every named instruction encodes and decodes back to its own name -----

// benignFields fills in operand values that are always legal for a class,
// so the loop below is only exercising each instruction's own identity bits.
function benignFields(inst) {
  const f = { sf: 1, rd: 10, rn: 11, rm: 12, rt: 13, sh: 0, n: 0, immr: 0, imms: 0, hw: 0, imm16: 0x2222, shiftop: 0, shift: 0, imm6: 0, imm12: 3, imm19: 50, imm26: 50, cond: 0, o0: 0 };
  if (inst.class === "ldst_imm") {
    f.size = inst.size;
    f.opc = (0b111001 << 2) | inst.opc2;
  } else {
    f.opc = inst.opc;
  }
  return f;
}

test("every instruction in scope encodes and decodes back to its own name", () => {
  for (const inst of a.INSTRUCTIONS) {
    const encoded = enc(inst.class, benignFields(inst));
    assert.ok(!encoded.Instruction.startsWith("no instruction"), `${inst.name} (${inst.class}) failed to encode: ${encoded.Instruction}`);
    const decoded = dec(encoded.Hex, "hex");
    const mnemonic = (line) => line.split(/[ .]/)[0];
    assert.equal(mnemonic(decoded.Instruction), inst.name.split(".")[0], `${inst.name} decodes from ${encoded.Hex}`);
    assert.equal(decoded.Bits, encoded.Bits.replace(/ /g, ""), `${inst.name} round trip`);
  }
});

test("B.cond names every condition, including the reserved al/nv pair", () => {
  for (let cond = 0; cond < 16; cond++) {
    const got = enc("b_cond", { opc: 0b01010100, imm19: 0, cond });
    assert.equal(got.Instruction, `b.${a.condName(cond)} #0`);
  }
});
