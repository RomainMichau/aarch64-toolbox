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
import { bitfieldAlias } from "../docs/tools/aarch64/dataproc-imm.js";

const bits = (n, width) => (n >>> 0).toString(2).padStart(width, "0");

const values = (id, inputs) =>
  Object.fromEntries(run(id, inputs).fields.map((f) => [f.label, f.value]));

// enc fills the boxes a class's layout calls for. fields is { id: number },
// class is added automatically from cls.
const enc = (cls, fields) => {
  const idx = a.CLASS_KEYS.indexOf(cls);
  const input = { class: bits(idx, a.CLASS_SELECTOR_WIDTH) };
  for (const [id, spec] of a.layout(cls)) input[id] = bits(fields[id] ?? 0, spec.width);
  return values("aarch64-encode", input);
};

// markerFill reads a class's own MARKERS entry (aarch64/index.js) and
// returns the field values it requires — every class-identifying marker
// bit, computed from the same table classify() itself reads rather than
// duplicated by hand, so a marker change here cannot go stale.
const markerFill = (cls) => {
  const entry = a.MARKERS.find(([c]) => c === cls);
  const out = {};
  if (!entry) return out;
  for (const { shift, width, value } of entry[1]) {
    for (const [id, spec] of a.layout(cls)) if (spec.shift === shift && spec.width === width) out[id] = value;
  }
  return out;
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

test("ADD / SUB (immediate) — ADDS/SUBS, and CMP/CMN are SUBS/ADDS with Rd=xzr", () => {
  const adds = enc("addsub_imm", { sf: 1, opc: 0b01100010, sh: 0, imm12: 1, rn: 0, rd: 2 });
  assert.equal(adds.Instruction, "adds x2, x0, #1");
  assert.equal(adds.Effect, "x2 = x0 + 1, flags set");

  const cmp = enc("addsub_imm", { sf: 1, opc: 0b11100010, sh: 0, imm12: 5, rn: 0, rd: 31 });
  assert.equal(cmp.Instruction, "cmp x0, #5");
  assert.equal(cmp.Effect, "flags = flagsOf(x0 - 5)");

  const cmn = enc("addsub_imm", { sf: 1, opc: 0b01100010, sh: 0, imm12: 5, rn: 1, rd: 31 });
  assert.equal(cmn.Instruction, "cmn x1, #5");
});

test("AND / ORR / EOR (immediate) — the bitmask immediate decodes to its real value", () => {
  // N=0, immr=0, imms=0, 32 bit: a single 1 bit, per DecodeBitMasks.
  const got = enc("logical_imm", { sf: 0, opc: 0b01100100, n: 0, immr: 0, imms: 0, rn: 1, rd: 0 });
  assert.equal(got.Hex, "0x32000020");
  assert.equal(got.Instruction, "orr w0, w1, #0x1");
  assert.equal(got.Effect, "w0 = w1 | 0x1");
});

test("AND / ORR / EOR (immediate) — ANDS, TST (Rd=xzr), and MOV (Rn=xzr)", () => {
  // sf=0 keeps N=0's 32 bit element the whole register, so #0x1 means
  // exactly bit 0 rather than DecodeBitMasks tiling it across 64 bits too.
  const ands = enc("logical_imm", { sf: 0, opc: 0b11100100, n: 0, immr: 0, imms: 0, rn: 1, rd: 0 });
  assert.equal(ands.Instruction, "ands w0, w1, #0x1");

  const tst = enc("logical_imm", { sf: 0, opc: 0b11100100, n: 0, immr: 0, imms: 0, rn: 1, rd: 31 });
  assert.equal(tst.Instruction, "tst w1, #0x1");
  assert.equal(tst.Effect, "flags = flagsOf(w1 & 0x1)");

  const mov = enc("logical_imm", { sf: 0, opc: 0b01100100, n: 0, immr: 0, imms: 0, rn: 31, rd: 0 });
  assert.equal(mov.Instruction, "mov w0, #0x1");
  assert.equal(mov.Effect, "w0 = 0x1");
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

  const cmp = enc("addsub_reg", { sf: 1, opc: 0b1101011, shiftop: 0, rm: 2, imm6: 0, rn: 1, rd: 31 });
  assert.equal(cmp.Instruction, "cmp x1, x2");
});

test("ADD / SUB (extended register) — the pointer-arithmetic form addsub_reg's own guard excludes", () => {
  const got = enc("addsub_ext", { sf: 1, opc: 0b0001011, opt: 0, one21: 1, rm: 2, option: 0b010, imm3: 2, rn: 1, rd: 0 });
  assert.equal(got.Instruction, "add x0, x1, w2, uxtw #2");
  assert.equal(got.Effect, "x0 = x1 + uxtw(w2) << 2");

  const cmn = enc("addsub_ext", { sf: 1, opc: 0b0101011, opt: 0, one21: 1, rm: 2, option: 0b011, imm3: 0, rn: 1, rd: 31 });
  assert.equal(cmn.Instruction, "cmn x1, x2, uxtx");

  // addsub_reg's own extended-register test still proves the marker split:
  // this same bit pattern classified as addsub_reg (shiftop&1) used to be
  // "out of scope"; it now has its own class and a real name.
  const stillAddsubReg = enc("addsub_reg", { sf: 1, opc: 0b0001011, shiftop: 0b001, rm: 1, imm6: 0, rn: 0, rd: 0 });
  assert.equal(stillAddsubReg.Class, "ADD/SUB (register)");
  assert.equal(stillAddsubReg.Instruction, "no instruction in scope has these fields");
});

test("AND / ORR / EOR (register) — mov is orr with no shift and xzr", () => {
  const got = enc("logical_reg", { sf: 1, opc: 0b0101010, shift: 0, n: 0, rm: 1, imm6: 0, rn: 31, rd: 0 });
  assert.equal(got.Hex, "0xAA0103E0");
  assert.equal(got.Instruction, "mov x0, x1");
  assert.equal(got.Effect, "x0 = x1");
});

test("AND / ORR / EOR (register) — N=1 negates Rm: BIC/ORN/EON/BICS, and mvn is orn with xzr", () => {
  const bic = enc("logical_reg", { sf: 1, opc: 0b0001010, shift: 0, n: 1, rm: 2, imm6: 0, rn: 1, rd: 0 });
  assert.equal(bic.Instruction, "bic x0, x1, x2");
  assert.equal(bic.Effect, "x0 = x1 & ~x2");

  const mvn = enc("logical_reg", { sf: 1, opc: 0b0101010, shift: 0, n: 1, rm: 1, imm6: 0, rn: 31, rd: 0 });
  assert.equal(mvn.Instruction, "mvn x0, x1");
  assert.equal(mvn.Effect, "x0 = ~x1");

  const tst = enc("logical_reg", { sf: 1, opc: 0b1101010, shift: 0, n: 0, rm: 1, imm6: 0, rn: 2, rd: 31 });
  assert.equal(tst.Instruction, "tst x2, x1");
});

test("LDR / STR (immediate) at all four sizes", () => {
  assert.equal(enc("ldst_imm", { size: 0b00, opc: 0b11100100, imm12: 0, rn: 1, rt: 0 }).Instruction, "strb w0, [x1]");
  assert.equal(enc("ldst_imm", { size: 0b01, opc: 0b11100101, imm12: 2, rn: 1, rt: 0 }).Instruction, "ldrh w0, [x1, #4]");
  assert.equal(enc("ldst_imm", { size: 0b10, opc: 0b11100100, imm12: 1, rn: 2, rt: 3 }).Instruction, "str w3, [x2, #4]");
  const x = enc("ldst_imm", { size: 0b11, opc: 0b11100101, imm12: 1, rn: 1, rt: 0 });
  assert.equal(x.Hex, "0xF9400420");
  assert.equal(x.Instruction, "ldr x0, [x1, #8]");
});

test("LDR / STR (immediate) — the signed loads pick Wt/Xt from opc2, not size", () => {
  const ldrsbX = enc("ldst_imm", { size: 0b00, opc: 0b11100110, imm12: 0, rn: 1, rt: 0 }); // opc2=10
  assert.equal(ldrsbX.Instruction, "ldrsb x0, [x1]");
  const ldrsbW = enc("ldst_imm", { size: 0b00, opc: 0b11100111, imm12: 0, rn: 1, rt: 0 }); // opc2=11
  assert.equal(ldrsbW.Instruction, "ldrsb w0, [x1]");
  const ldrsw = enc("ldst_imm", { size: 0b10, opc: 0b11100110, imm12: 0, rn: 1, rt: 0 });
  assert.equal(ldrsw.Instruction, "ldrsw x0, [x1]");
});

test("SBFM/BFM/UBFM — verified against immr=0,imms=7 (UXTB's own shape) = 0x53001C20, and every alias", () => {
  // immr=0, imms=7 is UXTB's own condition (see bitfieldAlias) — the same
  // immr/imms this exact hex was verified against before this alias logic
  // existed, so this doubles as the alias table's own regression check.
  const uxtb = enc("bitfield", { sf: 0, opc: 0b10, fixed: 0b100110, n: 0, immr: 0, imms: 7, rn: 1, rd: 0 });
  assert.equal(uxtb.Hex, "0x53001C20");
  assert.equal(uxtb.Instruction, "uxtb w0, w1");

  const ubfx = enc("bitfield", { sf: 0, opc: 0b10, fixed: 0b100110, n: 0, immr: 4, imms: 11, rn: 1, rd: 0 });
  assert.equal(ubfx.Instruction, "ubfx w0, w1, #4, #8");

  const sxtb = enc("bitfield", { sf: 0, opc: 0b00, fixed: 0b100110, n: 0, immr: 0, imms: 7, rn: 1, rd: 0 });
  assert.equal(sxtb.Instruction, "sxtb w0, w1");

  const sxtw = enc("bitfield", { sf: 1, opc: 0b00, fixed: 0b100110, n: 1, immr: 0, imms: 31, rn: 1, rd: 0 });
  assert.equal(sxtw.Instruction, "sxtw x0, w1");

  // LSL x0, x1, #4 == UBFM x0, x1, #(64-4), #(64-1-4) = immr=60, imms=59.
  const lsl = enc("bitfield", { sf: 1, opc: 0b10, fixed: 0b100110, n: 1, immr: 60, imms: 59, rn: 1, rd: 0 });
  assert.equal(lsl.Instruction, "lsl x0, x1, #4");

  const asr = enc("bitfield", { sf: 0, opc: 0b00, fixed: 0b100110, n: 0, immr: 8, imms: 31, rn: 1, rd: 0 });
  assert.equal(asr.Instruction, "asr w0, w1, #8");

  // BFI w0, w1, #4, #8 == BFM w0, w1, #(32-4), #7 = immr=28, imms=7.
  const bfi = enc("bitfield", { sf: 0, opc: 0b01, fixed: 0b100110, n: 0, immr: 28, imms: 7, rn: 1, rd: 0 });
  assert.equal(bfi.Instruction, "bfi w0, w1, #4, #8");

  const bfxil = enc("bitfield", { sf: 0, opc: 0b01, fixed: 0b100110, n: 0, immr: 4, imms: 11, rn: 1, rd: 0 });
  assert.equal(bfxil.Instruction, "bfxil w0, w1, #4, #8");
});

test("EXTR, and ROR (immediate) as EXTR with Rm=Rn", () => {
  const extr = enc("extract", { sf: 1, op21: 0, fixed: 0b100111, n: 1, o0: 0, rm: 2, lsb: 16, rn: 1, rd: 0 });
  assert.equal(extr.Instruction, "extr x0, x1, x2, #16");

  const ror = enc("extract", { sf: 0, op21: 0, fixed: 0b100111, n: 0, o0: 0, rm: 1, lsb: 8, rn: 1, rd: 0 });
  assert.equal(ror.Instruction, "ror w0, w1, #8");
  assert.equal(ror.Effect, "w0 = w1 rotated right by 8 — shown as ROR when Rm and Rn are the same register");
});

test("ADR, ADRP — verified against adr x0,.=0x10000000 and adrp x0,.=0x90000000", () => {
  const adr = enc("pcrel", { op: 0, immlo: 0, fixed: 0b10000, immhi: 0, rd: 0 });
  assert.equal(adr.Hex, "0x10000000");
  assert.equal(adr.Instruction, "adr x0, #0");

  const adrp = enc("pcrel", { op: 1, immlo: 0, fixed: 0b10000, immhi: 0, rd: 0 });
  assert.equal(adrp.Hex, "0x90000000");
  assert.equal(adrp.Instruction, "adrp x0, #0");

  const adrpOffset = enc("pcrel", { op: 1, immlo: 0b01, fixed: 0b10000, immhi: 1, rd: 0 });
  assert.equal(adrpOffset.Instruction, "adrp x0, #20480"); // immhi:immlo = (1<<2)|1 = 5 -> 5*4096
});

test("ADD / SUB (extended register), and its CMP/CMN aliases", () => {
  const got = enc("addsub_ext", { sf: 1, opc: 0b0001011, opt: 0, one21: 1, rm: 2, option: 0b010, imm3: 2, rn: 1, rd: 0 });
  assert.equal(got.Instruction, "add x0, x1, w2, uxtw #2");
});

test("CSEL/CSINC/CSINV/CSNEG, and the CSET/CSETM/CINC/CINV/CNEG aliases", () => {
  const csel = enc("condselect", { sf: 1, op: 0, s: 0, fixed: 0b11010100, rm: 2, cond: 0, op2: 0b00, rn: 1, rd: 0 });
  assert.equal(csel.Instruction, "csel x0, x1, x2, eq");

  // CSET x0, ne == CSINC x0, xzr, xzr, eq (the *inverted* cond is encoded).
  const cset = enc("condselect", { sf: 1, op: 0, s: 0, fixed: 0b11010100, rm: 31, cond: 0b0000, op2: 0b01, rn: 31, rd: 0 });
  assert.equal(cset.Instruction, "cset x0, ne");

  const csetm = enc("condselect", { sf: 1, op: 1, s: 0, fixed: 0b11010100, rm: 31, cond: 0b0000, op2: 0b00, rn: 31, rd: 0 });
  assert.equal(csetm.Instruction, "csetm x0, ne");

  // CINC x0, x1, ne == CSINC x0, x1, x1, eq.
  const cinc = enc("condselect", { sf: 1, op: 0, s: 0, fixed: 0b11010100, rm: 1, cond: 0b0000, op2: 0b01, rn: 1, rd: 0 });
  assert.equal(cinc.Instruction, "cinc x0, x1, ne");

  const cneg = enc("condselect", { sf: 1, op: 1, s: 0, fixed: 0b11010100, rm: 1, cond: 0b0001, op2: 0b01, rn: 1, rd: 0 });
  assert.equal(cneg.Instruction, "cneg x0, x1, eq");

  // AL/NV are not invertible, so CSINC with Rn=Rm=xzr and cond=al stays csinc.
  const notCset = enc("condselect", { sf: 1, op: 0, s: 0, fixed: 0b11010100, rm: 31, cond: 0b1110, op2: 0b01, rn: 31, rd: 0 });
  assert.equal(notCset.Instruction, "csinc x0, xzr, xzr, al");
});

test("CCMP / CCMN, register and immediate operand forms", () => {
  const ccmpReg = enc("condcompare", { sf: 1, op: 1, s: 1, fixed: 0b11010010, rm_imm: 2, cond: 0, flag: 0, o3: 0, rn: 1, o4: 0, nzcv: 4 });
  assert.equal(ccmpReg.Instruction, "ccmp x1, x2, #4, eq");

  const ccmnImm = enc("condcompare", { sf: 0, op: 0, s: 1, fixed: 0b11010010, rm_imm: 5, cond: 1, flag: 1, o3: 0, rn: 1, o4: 0, nzcv: 2 });
  assert.equal(ccmnImm.Instruction, "ccmn w1, #5, #2, ne");
});

test("LSLV / LSRV / ASRV / RORV, SDIV / UDIV", () => {
  const sdiv = enc("dp2src", { sf: 1, zero30: 0, s: 0, fixed: 0b11010110, rm: 2, opcode: 0b000011, rn: 1, rd: 0 });
  assert.equal(sdiv.Instruction, "sdiv x0, x1, x2");
  assert.equal(sdiv.Effect, "x0 = x1 / x2, signed");

  const lslv = enc("dp2src", { sf: 0, zero30: 0, s: 0, fixed: 0b11010110, rm: 2, opcode: 0b001000, rn: 1, rd: 0 });
  assert.equal(lslv.Instruction, "lslv w0, w1, w2");
});

test("RBIT / REV16 / REV / REV32 / CLZ / CLS — REV vs REV32 told apart by sf alone", () => {
  const clz = enc("dp1src", { sf: 1, one30: 1, s: 0, fixed: 0b11010110, opcode2: 0, opcode: 0b000100, rn: 1, rd: 0 });
  assert.equal(clz.Instruction, "clz x0, x1");

  const rev32 = enc("dp1src", { sf: 1, one30: 1, s: 0, fixed: 0b11010110, opcode2: 0, opcode: 0b000010, rn: 1, rd: 0 });
  assert.equal(rev32.Instruction, "rev32 x0, x1");

  const rev = enc("dp1src", { sf: 0, one30: 1, s: 0, fixed: 0b11010110, opcode2: 0, opcode: 0b000010, rn: 1, rd: 0 });
  assert.equal(rev.Instruction, "rev w0, w1");

  const rev64 = enc("dp1src", { sf: 1, one30: 1, s: 0, fixed: 0b11010110, opcode2: 0, opcode: 0b000011, rn: 1, rd: 0 });
  assert.equal(rev64.Instruction, "rev x0, x1");
});

test("MADD/MSUB and the widening/high multiplies — verified structurally against mul w0,w1,w2 (0x1B prefix)", () => {
  const mul = enc("dp3src", { sf: 0, op54: 0, fixed: 0b11011, op31: 0, rm: 2, o0: 0, ra: 31, rn: 1, rd: 0 });
  assert.equal(mul.Hex, "0x1B027C20");
  assert.equal(mul.Instruction, "mul w0, w1, w2");

  const madd = enc("dp3src", { sf: 0, op54: 0, fixed: 0b11011, op31: 0, rm: 2, o0: 0, ra: 3, rn: 1, rd: 0 });
  assert.equal(madd.Instruction, "madd w0, w1, w2, w3");

  const smull = enc("dp3src", { sf: 1, op54: 0, fixed: 0b11011, op31: 0b001, rm: 2, o0: 0, ra: 31, rn: 1, rd: 0 });
  assert.equal(smull.Instruction, "smull x0, w1, w2");

  const umulh = enc("dp3src", { sf: 1, op54: 0, fixed: 0b11011, op31: 0b110, rm: 2, o0: 0, ra: 31, rn: 1, rd: 0 });
  assert.equal(umulh.Instruction, "umulh x0, x1, x2");
});

test("TBZ / TBNZ — verified: tbnz w0,#0,. packs to the well known 0x37 prefix", () => {
  const tbnz = enc("tbz_tbnz", { b5: 0, fixed: 0b011011, op: 1, b40: 0, imm14: 0, rt: 0 });
  assert.equal(tbnz.Hex, "0x37000000");
  assert.equal(tbnz.Instruction, "tbnz w0, #0, #0");

  const tbz64 = enc("tbz_tbnz", { b5: 1, fixed: 0b011011, op: 0, b40: 5, imm14: 4, rt: 1 });
  assert.equal(tbz64.Instruction, "tbz x1, #37, #16");
});

test("BR / BLR / RET — verified against br x0=0xD61F0000 and ret=0xD65F03C0", () => {
  const br = enc("br_reg", { fixed1: 0b1101011, z: 0, op: 0, a: 0, op2: 0b11111, op3: 0, rn: 0, op4: 0 });
  assert.equal(br.Hex, "0xD61F0000");
  assert.equal(br.Instruction, "br x0");

  const ret = enc("br_reg", { fixed1: 0b1101011, z: 0, op: 1, a: 0, op2: 0b11111, op3: 0, rn: 30, op4: 0 });
  assert.equal(ret.Hex, "0xD65F03C0");
  assert.equal(ret.Instruction, "ret");

  const retOther = enc("br_reg", { fixed1: 0b1101011, z: 0, op: 1, a: 0, op2: 0b11111, op3: 0, rn: 5, op4: 0 });
  assert.equal(retOther.Instruction, "ret x5");

  const blr = enc("br_reg", { fixed1: 0b1101011, z: 0, op: 0b10, a: 0, op2: 0b11111, op3: 0, rn: 3, op4: 0 });
  assert.equal(blr.Instruction, "blr x3");
});

test("LDUR / STUR, and LDR / STR pre/post-indexed", () => {
  const ldur = enc("ldst_unscaled", { size: 0b11, vfixed: 0b111000, opc: 0b01, zero21: 0, imm9: -8 & 0x1ff, idx: 0b00, rn: 1, rt: 0 });
  assert.equal(ldur.Instruction, "ldur x0, [x1, #-8]");

  const post = enc("ldst_unscaled", { size: 0b11, vfixed: 0b111000, opc: 0b01, zero21: 0, imm9: 16, idx: 0b01, rn: 1, rt: 0 });
  assert.equal(post.Instruction, "ldr x0, [x1], #16");
  assert.match(post.Effect, /x1 \+= 16/);

  const pre = enc("ldst_unscaled", { size: 0b11, vfixed: 0b111000, opc: 0b00, zero21: 0, imm9: -16 & 0x1ff, idx: 0b11, rn: 31, rt: 0 });
  assert.equal(pre.Instruction, "str x0, [sp, #-16]!");
});

test("LDR / STR — register offset", () => {
  const got = enc("ldst_regoffset", { size: 0b11, vfixed: 0b111000, opc: 0b01, one21: 1, rm: 2, option: 0b011, s: 0, fixed10: 0b10, rn: 1, rt: 0 });
  assert.equal(got.Instruction, "ldr x0, [x1, x2]");

  const scaled = enc("ldst_regoffset", { size: 0b11, vfixed: 0b111000, opc: 0b00, one21: 1, rm: 2, option: 0b111, s: 1, fixed10: 0b10, rn: 1, rt: 0 });
  assert.equal(scaled.Instruction, "str x0, [x1, x2, sxtx #3]");
});

test("LDP / STP — verified against stp x0,x1,[sp,#-16]!=0xA9BF07E0 and ldp x29,x30,[sp],#16=0xA8C17BFD", () => {
  const stp = enc("ldst_pair", { opc: 0b10, fixed: 0b101, v: 0, idx: 0b011, l: 0, imm7: -2 & 0x7f, rt2: 1, rn: 31, rt: 0 });
  assert.equal(stp.Hex, "0xA9BF07E0");
  assert.equal(stp.Instruction, "stp x0, x1, [sp, #-16]!");

  const ldp = enc("ldst_pair", { opc: 0b10, fixed: 0b101, v: 0, idx: 0b001, l: 1, imm7: 2, rt2: 30, rn: 31, rt: 29 });
  assert.equal(ldp.Hex, "0xA8C17BFD");
  assert.equal(ldp.Instruction, "ldp x29, x30, [sp], #16");

  const wpair = enc("ldst_pair", { opc: 0b00, fixed: 0b101, v: 0, idx: 0b010, l: 0, imm7: 1, rt2: 1, rn: 2, rt: 0 });
  assert.equal(wpair.Instruction, "stp w0, w1, [x2, #4]");
});

test("LDXR/STXR, LDAXR/STLXR, LDAR/STLR, CAS family — verified against ldar x0,[x1]=0xC8DFFC20", () => {
  const ldar = enc("ldst_excl", { size: 0b11, fixed: 0b001000, o2: 1, l: 1, o1: 0, rs: 0b11111, o0: 1, rt2: 0b11111, rn: 1, rt: 0 });
  assert.equal(ldar.Hex, "0xC8DFFC20");
  assert.equal(ldar.Instruction, "ldar x0, [x1]");

  const stxr = enc("ldst_excl", { size: 0b11, fixed: 0b001000, o2: 0, l: 0, o1: 0, rs: 2, o0: 0, rt2: 0b11111, rn: 1, rt: 0 });
  assert.equal(stxr.Instruction, "stxr w2, x0, [x1]");

  const ldaxr = enc("ldst_excl", { size: 0b11, fixed: 0b001000, o2: 0, l: 1, o1: 0, rs: 0b11111, o0: 1, rt2: 0b11111, rn: 1, rt: 0 });
  assert.equal(ldaxr.Instruction, "ldaxr x0, [x1]");

  const casal = enc("ldst_excl", { size: 0b11, fixed: 0b001000, o2: 0, l: 1, o1: 1, rs: 1, o0: 1, rt2: 0b11111, rn: 2, rt: 0 });
  assert.equal(casal.Instruction, "casal x1, x0, [x2]");
});

test("LDR (literal) — verified against ldr x0,<label>=0x58000000", () => {
  const got = enc("ldst_literal", { opc: 0b01, fixed: 0b011000, imm19: 0, rt: 0 });
  assert.equal(got.Hex, "0x58000000");
  assert.equal(got.Instruction, "ldr x0, #0");

  const ldrsw = enc("ldst_literal", { opc: 0b10, fixed: 0b011000, imm19: 4, rt: 0 });
  assert.equal(ldrsw.Instruction, "ldrsw x0, #16");
});

test("LDADD/LDCLR/LDEOR/LDSET/..., SWP — every A/R ordering is generated, not hand-picked", () => {
  const ldadd = enc("atomic_ldop", { size: 0b10, vfixed: 0b111000, a: 0, r: 0, one21: 1, rs: 1, opc: 0b0000, fixed10: 0, rn: 2, rt: 0 });
  assert.equal(ldadd.Instruction, "ldadd w1, w0, [x2]");

  const ldaddal = enc("atomic_ldop", { size: 0b11, vfixed: 0b111000, a: 1, r: 1, one21: 1, rs: 1, opc: 0b0000, fixed10: 0, rn: 2, rt: 0 });
  assert.equal(ldaddal.Instruction, "ldaddal x1, x0, [x2]");

  const swpa = enc("atomic_ldop", { size: 0b11, vfixed: 0b111000, a: 1, r: 0, one21: 1, rs: 1, opc: 0b1000, fixed10: 0, rn: 2, rt: 0 });
  assert.equal(swpa.Instruction, "swpa x1, x0, [x2]");
});

test("Hints (NOP, ...) and barriers — verified against nop=0xD503201F, dsb sy=0xD5033F9F", () => {
  const nop = enc("sysmisc", { fixed: 0xD503, crn: 0b0010, crm: 0b0000, op2: 0b000, rt: 0b11111 });
  assert.equal(nop.Hex, "0xD503201F");
  assert.equal(nop.Instruction, "nop");

  const dsb = enc("sysmisc", { fixed: 0xD503, crn: 0b0011, crm: 0b1111, op2: 0b100, rt: 0b11111 });
  assert.equal(dsb.Hex, "0xD5033F9F");
  assert.equal(dsb.Instruction, "dsb sy");

  const isb = enc("sysmisc", { fixed: 0xD503, crn: 0b0011, crm: 0b1111, op2: 0b110, rt: 0b11111 });
  assert.equal(isb.Hex, "0xD5033FDF");
  assert.equal(isb.Instruction, "isb sy");
});

test("SVC / BRK / HLT — verified against svc #0=0xD4000001, brk #0=0xD4200000, hlt #0=0xD4400000", () => {
  const svc = enc("excgen", { fixed: 0xD4, opc: 0b000, imm16: 0, opc2: 0, ll: 0b01 });
  assert.equal(svc.Hex, "0xD4000001");
  assert.equal(svc.Instruction, "svc #0");

  const brk = enc("excgen", { fixed: 0xD4, opc: 0b001, imm16: 0, opc2: 0, ll: 0b00 });
  assert.equal(brk.Hex, "0xD4200000");
  assert.equal(brk.Instruction, "brk #0");

  const hlt = enc("excgen", { fixed: 0xD4, opc: 0b010, imm16: 0x1234, opc2: 0, ll: 0b00 });
  assert.equal(hlt.Hex, "0xD4424680");
  assert.equal(hlt.Instruction, "hlt #4660");
});

// --- Encoder: things outside the declared scope classify but do not name ---
//
// addsub_imm and logical_imm's opc bits are now fully covered (op×S and the
// 2 bit opc respectively both have every combination named), so neither has
// a reserved sibling left to test here the way the pre-expansion core did —
// see instead the still-reserved combinations below.

test("addsub_reg rejects a shiftop whose bit 21 is set — that word is really addsub_ext, a different class now", () => {
  const got = enc("addsub_reg", { sf: 1, opc: 0b0001011, shiftop: 0b001, rm: 1, imm6: 0, rn: 0, rd: 0 });
  assert.equal(got.Class, "ADD/SUB (register)");
  assert.equal(got.Instruction, "no instruction in scope has these fields");

  // The same bits, read as addsub_ext instead, do name a real instruction.
  const asExt = enc("addsub_ext", { sf: 1, opc: 0b0001011, opt: 0, one21: 1, rm: 1, option: 0, imm3: 0, rn: 0, rd: 0 });
  assert.equal(asExt.Instruction, "add x0, x0, w1, uxtb");
});

test("addsub_ext rejects a reserved opt value, and a one21 that contradicts the class", () => {
  const reservedOpt = enc("addsub_ext", { sf: 1, opc: 0b0001011, opt: 0b01, one21: 1, rm: 1, option: 0, imm3: 0, rn: 0, rd: 0 });
  assert.equal(reservedOpt.Instruction, "no instruction in scope has these fields");

  const wrongMarker = enc("addsub_ext", { sf: 1, opc: 0b0001011, opt: 0, one21: 0, rm: 1, option: 0, imm3: 0, rn: 0, rd: 0 });
  assert.equal(wrongMarker.Instruction, "no instruction in scope has these fields");
});

test("condselect rejects the reserved op2 values 10/11", () => {
  const got = enc("condselect", { sf: 1, op: 0, s: 0, fixed: 0b11010100, rm: 1, cond: 0, op2: 0b10, rn: 0, rd: 0 });
  assert.equal(got.Instruction, "no instruction in scope has these fields");
});

test("dp1src rejects a non-zero opcode2, and dp3src's widening multiplies require sf=1", () => {
  const badOpcode2 = enc("dp1src", { sf: 0, one30: 1, s: 0, fixed: 0b11010110, opcode2: 1, opcode: 0b000100, rn: 0, rd: 0 });
  assert.equal(badOpcode2.Instruction, "no instruction in scope has these fields");

  const smaddl32 = enc("dp3src", { sf: 0, op54: 0, fixed: 0b11011, op31: 0b001, rm: 1, o0: 0, ra: 2, rn: 0, rd: 0 });
  assert.equal(smaddl32.Instruction, "no instruction in scope has these fields");
});

test("ldst_pair rejects opc=01 (a SIMD/FP pair) and idx=000 (STNP/LDNP)", () => {
  const simdOpc = enc("ldst_pair", { opc: 0b01, fixed: 0b101, v: 0, idx: 0b010, l: 1, imm7: 0, rt2: 1, rn: 2, rt: 0 });
  assert.equal(simdOpc.Instruction, "no instruction in scope has these fields");

  const stnp = enc("ldst_pair", { opc: 0b10, fixed: 0b101, v: 0, idx: 0b000, l: 0, imm7: 0, rt2: 1, rn: 2, rt: 0 });
  assert.equal(stnp.Instruction, "no instruction in scope has these fields");
});

test("ldst_excl rejects byte/halfword sizes, and the RCpc LDAPR/STLLR combination", () => {
  const byteExcl = enc("ldst_excl", { size: 0b00, fixed: 0b001000, o2: 0, l: 1, o1: 0, rs: 31, o0: 0, rt2: 31, rn: 1, rt: 0 });
  assert.equal(byteExcl.Instruction, "no instruction in scope has these fields");

  const ldapr = enc("ldst_excl", { size: 0b11, fixed: 0b001000, o2: 1, l: 1, o1: 0, rs: 31, o0: 0, rt2: 31, rn: 1, rt: 0 });
  assert.equal(ldapr.Instruction, "no instruction in scope has these fields");
});

test("a reserved bitmask immediate reports why, not a wrong value", () => {
  // imms == levels (here imms = 31 = levels for a 32 bit element) is reserved
  // per DecodeBitMasks — a valid-looking N/immr/imms that names no real
  // immediate, so it surfaces as a field explaining why, the same way an
  // unrecognised opcode does, not as a thrown, red "error".
  const got = enc("logical_imm", { sf: 0, opc: 0b00100100, n: 0, immr: 0, imms: 0b011111, rn: 0, rd: 0 });
  assert.match(got.Immediate, /reserved/);
});

test("a class outside the known range says so", () => {
  const outOfRange = (1 << a.CLASS_SELECTOR_WIDTH) - 1; // all ones is past CLASS_KEYS.length - 1
  const got = values("aarch64-encode", { class: bits(outOfRange, a.CLASS_SELECTOR_WIDTH) });
  assert.equal(got.Class, `${outOfRange} is not a class this toolbox knows — pick 0-${a.CLASS_KEYS.length - 1}`);
});

// --- Encoder: field-width overflow and non-binary input --------------------

test("field-width overflow throws a clear error", () => {
  const got = run("aarch64-encode", {
    class: bits(a.CLASS_KEYS.indexOf("addsub_imm"), a.CLASS_SELECTOR_WIDTH),
    sf: "1", opc: bits(0b00100010, 8), sh: "0", imm12: "1".repeat(13), rn: bits(0, 5), rd: bits(0, 5),
  });
  assert.equal(got.error, "imm12: 13 bits given, field is 12 bits wide");
});

test("non-binary characters in a field throw", () => {
  const got = run("aarch64-encode", {
    class: bits(a.CLASS_KEYS.indexOf("addsub_reg"), a.CLASS_SELECTOR_WIDTH),
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
  assert.equal(sendable.class, bits(a.CLASS_KEYS.indexOf("addsub_reg"), a.CLASS_SELECTOR_WIDTH));

  const reEncoded = values("aarch64-encode", sendable);
  assert.equal(reEncoded.Hex, "0x8B020020");
  assert.equal(reEncoded.Instruction, "add x0, x1, x2");
});

// --- Every named instruction encodes and decodes back to its own name -----

// benignFields fills in operand values that are always legal for a class —
// and, critically, that never accidentally satisfy an *alias's own*
// condition (Rd/Rn=31, Ra=31, Rn=Rm, ...) so the loop below always sees
// each INSTRUCTIONS row's own base name, not one of its aliases (those get
// their own dedicated tests above, alongside the plain encoder cases).
// markerFill supplies every class's own fixed marker bits; the rest is
// values chosen to be as boring — and as alias-proof — as possible.
function benignFields(inst) {
  const cls = inst.class;
  const base = {
    sf: 1, rd: 10, rn: 11, rm: 12, rt: 13, rt2: 14, rs: 15, ra: 9,
    sh: 0, immr: 0, imms: 7, hw: 0, imm16: 0x2222, shiftop: 0, shift: 0,
    imm6: 0, imm12: 3, imm19: 50, imm26: 50, cond: 2, opt: 0, option: 0b011,
    imm3: 0, s: 0, one30: 1, zero30: 0, opcode2: 0, op21: 0, idx: 0b010,
    imm9: 8, imm7: 0, imm14: 20, b5: 0, b40: 5, immhi: 0, immlo: 0,
  };
  const f = { ...base, ...markerFill(cls), ...inst };
  // sfOnly-tagged dp1src/dp3src rows (REV vs REV32, the widening multiplies)
  // are only found at their own required sf — the generic sf:1 above is
  // wrong for the sf:0 half of dp1src's pair.
  if (inst.sfOnly !== undefined) f.sf = inst.sfOnly;
  // The instruction tables key ldst_imm/ldst_regoffset by opc2, a 2 bit
  // sub-field of the wider opc box; ldst_excl/atomic_ldop only name the
  // word/doubleword sizes; br_reg's op2/op3/op4 and sysmisc's Rt are fixed
  // marker values with no layout-level default.
  if (cls === "ldst_imm") f.opc = ((f.opc ?? 0b111001) << 2) | (inst.opc2 ?? 0);
  if (cls === "ldst_regoffset" || cls === "ldst_unscaled") f.opc = inst.opc2 ?? 0;
  if (cls === "ldst_excl" || cls === "atomic_ldop") f.size = 0b11;
  if (cls === "br_reg") { f.rn = 30; f.op2 = 0b11111; f.op3 = 0; f.op4 = 0; }
  if (cls === "sysmisc") f.rt = 0b11111;
  return f;
}

test("every instruction in scope encodes and decodes back to its own name", () => {
  for (const inst of a.INSTRUCTIONS) {
    const fields = benignFields(inst);
    const encoded = enc(inst.class, fields);
    assert.ok(!encoded.Instruction.startsWith("no instruction"), `${inst.name} (${inst.class}) failed to encode: ${encoded.Instruction}`);
    const decoded = dec(encoded.Hex, "hex");
    const mnemonic = (line) => line.split(/[ .]/)[0];
    // Every SBFM/BFM/UBFM row always shows under one of its aliases (see
    // dataproc-imm.js's bitfieldAlias) — never its own base name — so this
    // is the one class checked against the alias bitfieldAlias itself
    // computes, rather than against inst.name.
    const expectedName = inst.class === "bitfield"
      ? bitfieldAlias(fields.sf === 1, inst.opc, fields.immr, fields.imms).name
      : inst.name.split(".")[0];
    assert.equal(mnemonic(decoded.Instruction), expectedName, `${inst.name} decodes from ${encoded.Hex}`);
    assert.equal(decoded.Bits, encoded.Bits.replace(/ /g, ""), `${inst.name} round trip`);
  }
});

test("B.cond names every condition, including the reserved al/nv pair", () => {
  for (let cond = 0; cond < 16; cond++) {
    const got = enc("b_cond", { opc: 0b01010100, imm19: 0, cond });
    assert.equal(got.Instruction, `b.${a.condName(cond)} #0`);
  }
});
