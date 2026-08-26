// An AArch64 instruction is always a 32 bit word — unlike RISC-V, there is no
// single contiguous opcode field that names the format the way RV32's low 7
// bits do. Which fields a word has depends on its *class* (branch, the two
// data-processing families, load/store), and each class's own identifying
// bits sit at a different position and width. So this toolbox adds one thing
// real hardware does not have: a `class` selector box the encoder reads to
// pick a layout, the same job RISC-V's opcode field does for free. It is
// never packed into the word — `class` is not one of the fields layout()
// returns, so encode.js reads it separately and leaves it out of packWord's
// input. The decoder, which only ever sees real 32 bit words, has no such
// shortcut: classify() below re-derives the class from the word's own fixed
// bits, the way a real disassembler would.
//
// Every field in every layout was checked against known objdump output for
// at least one instruction of its class (see the comments by CLASSES).

import { sliceFields, shiftToSlice } from "./bits.js";

export const WORD_BITS = 32;

// CLASSES: one entry per instruction class in scope. `layout` is the ordered
// [id, {shift, width}] list layout() returns — every bit of the word belongs
// to exactly one of these fields, the same contract RISC-V's FORMATS keeps.
export const CLASSES = {
  // B, BL — verified against `b .` = 0x14000000, `bl .` = 0x94000000.
  b_bl: {
    name: "B / BL",
    layout: [["opc", { shift: 26, width: 6 }], ["imm26", { shift: 0, width: 26 }]],
  },
  // B.cond — verified against `b.eq .` = 0x54000000.
  b_cond: {
    name: "B.cond",
    layout: [
      ["opc", { shift: 24, width: 8 }],
      ["imm19", { shift: 5, width: 19 }],
      ["o0", { shift: 4, width: 1 }],
      ["cond", { shift: 0, width: 4 }],
    ],
  },
  // CBZ, CBNZ — verified against `cbz w0, .` = 0x34000000, `cbnz x0, .` = 0xB5000000.
  cbz_cbnz: {
    name: "CBZ / CBNZ",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 24, width: 7 }],
      ["imm19", { shift: 5, width: 19 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // ADD/SUB (immediate) — verified against `add x0,x0,#0`=0x91000000,
  // `subs x0,x0,#5`(cmp)=0xF1... bases.
  addsub_imm: {
    name: "ADD/SUB (immediate)",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 23, width: 8 }],
      ["sh", { shift: 22, width: 1 }],
      ["imm12", { shift: 10, width: 12 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // AND/ORR/EOR (immediate) — verified against AND=0x92000000, ORR=0xB2000000
  // (also `mov` alias's base), EOR=0xD2000000 bases.
  logical_imm: {
    name: "AND/ORR/EOR (immediate)",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 23, width: 8 }],
      ["n", { shift: 22, width: 1 }],
      ["immr", { shift: 16, width: 6 }],
      ["imms", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // MOVZ/MOVN/MOVK — verified against `movz x0, #0x1234` = 0xD2824680.
  movewide: {
    name: "MOVZ/MOVN/MOVK",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 23, width: 8 }],
      ["hw", { shift: 21, width: 2 }],
      ["imm16", { shift: 5, width: 16 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // ADD/SUB (shifted register) — verified against `add x0,x1,x2` = 0x8B020020.
  addsub_reg: {
    name: "ADD/SUB (register)",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 24, width: 7 }],
      ["shiftop", { shift: 21, width: 3 }],
      ["rm", { shift: 16, width: 5 }],
      ["imm6", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // AND/ORR/EOR (shifted register) — verified against `mov x0,x1` (orr alias)
  // = 0xAA0103E0, AND base 0x8A000000, EOR base 0xCA000000.
  logical_reg: {
    name: "AND/ORR/EOR (register)",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 24, width: 7 }],
      ["shift", { shift: 22, width: 2 }],
      ["n", { shift: 21, width: 1 }],
      ["rm", { shift: 16, width: 5 }],
      ["imm6", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // LDR/STR (unsigned immediate offset) — verified against `str x0,[x1]` =
  // 0xF9000000, `ldr x0,[x1]` = 0xF9400020, `ldr w0,[x1]` base = 0xB9400000,
  // `strb w0,[x1]` base = 0x39000000, `ldrh w0,[x1]` base = 0x79400000.
  ldst_imm: {
    name: "LDR/STR (immediate)",
    layout: [
      ["size", { shift: 30, width: 2 }],
      ["opc", { shift: 22, width: 8 }],
      ["imm12", { shift: 10, width: 12 }],
      ["rn", { shift: 5, width: 5 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
};

// CLASS_KEYS is the order the toolbox's synthetic `class` selector box reads
// its 4 bits in — shared by encode.js (to turn a typed index into a class)
// and decode.js (to turn a classified word back into that index for the
// "send to encoder" handoff).
export const CLASS_KEYS = [
  "b_bl", "b_cond", "cbz_cbnz", "addsub_imm", "logical_imm",
  "movewide", "addsub_reg", "logical_reg", "ldst_imm",
];

export function layout(cls) {
  return CLASSES[cls]?.layout || [];
}

export function slices(cls) {
  return layout(cls).map(([id, f]) => [id, shiftToSlice(f.shift, f.width, WORD_BITS)]);
}

// Every class's `opc` (or, for ldst_imm, `opc`) field packs together some
// bits that are truly fixed for the whole class and some that are a real,
// independently-meaningful sub-selector within it (S for the add/sub
// families, the 2 bit opc for the logical and move-wide families, the real
// load/store opc for ldst_imm). classify() must match on the fixed marker
// alone, at its own (shift, width) below — matching the full opc field would
// mean a word using a sub-selector value this toolbox has no instruction
// for (ANDS, say) fails to classify at all, rather than classifying and
// correctly reporting no instruction, the way an unrecognised RISC-V opcode
// still resolves to a format. Checked disjoint against every other class's
// marker below by construction: each pair either sits at a different bit
// range, or the same range with a different constant.
const MARKERS = [
  ["b_bl", { shift: 26, width: 5 }, 0b00101],
  ["b_cond", { shift: 24, width: 8 }, 0b01010100],
  ["cbz_cbnz", { shift: 25, width: 6 }, 0b011010],
  ["addsub_imm", { shift: 23, width: 6 }, 0b100010],
  ["logical_imm", { shift: 23, width: 6 }, 0b100100],
  ["movewide", { shift: 23, width: 6 }, 0b100101],
  ["addsub_reg", { shift: 24, width: 5 }, 0b01011],
  ["logical_reg", { shift: 24, width: 5 }, 0b01010],
  ["ldst_imm", { shift: 24, width: 6 }, 0b111001],
];

// classifyStatus reads a 32 bit pattern's fixed marker bits and says which
// class it belongs to, the way a real disassembler walks the encoding table.
// A field still holding a decoder's variable letters cannot be tested; when
// that is the only reason nothing matched, `unknown` says so, so a decoder
// can tell "this cannot be any class in scope" apart from "not enough of the
// word is known yet to tell" — RISC-V never needs the distinction, since its
// one opcode field is always exactly at bits 6:0.
export function classifyStatus(pattern) {
  let unknown = false;
  for (const [cls, spec, value] of MARKERS) {
    const [from, to] = shiftToSlice(spec.shift, spec.width, WORD_BITS);
    const slice = pattern.slice(from, to);
    if (!/^[01]+$/.test(slice)) { unknown = true; continue; }
    if (parseInt(slice, 2) === value) return { cls, unknown: false };
  }
  return { cls: "", unknown };
}

export function classify(pattern) {
  return classifyStatus(pattern).cls;
}

// wordFields cuts a full 32 bit pattern into the named fields the encoder's
// boxes hold, so a decoded word can be handed straight to the encoder. Unlike
// RISC-V, the class the encoder needs is not itself one of those fields — the
// caller (decode.js's extractSendable) adds it in separately.
export function wordFields(pattern) {
  const cls = classify(pattern);
  return cls ? sliceFields(pattern, slices(cls)) : null;
}

// The instruction table. Every entry is matched on its class first, then on
// its opc value — the field that, per class, packs together every real ARM
// field that is fixed for a given mnemonic (op/S/opc bits plus the constant
// bits around them). `desc` is the effect, with rd/rn/rm/imm/... standing in
// for the operands. The S-setting (ADDS/SUBS/ANDS) and reserved siblings of
// these opc values are real, disjoint encodings — classify() still resolves
// them to their class — but are not named here, out of scope the same way
// riscv_toolbox's encoder does not know RV32F/D: typing their bits in gets
// "no instruction in scope has these fields" rather than a wrong answer.
export const INSTRUCTIONS = [
  { name: "b", class: "b_bl", opc: 0b000101, desc: "PC = PC + offset" },
  { name: "bl", class: "b_bl", opc: 0b100101, desc: "X30 = PC + 4; PC = PC + offset" },
  { name: "b.cond", class: "b_cond", opc: 0b01010100, desc: "if (cond) PC = PC + offset" },
  { name: "cbz", class: "cbz_cbnz", opc: 0b0110100, desc: "if (Rt == 0) PC = PC + offset" },
  { name: "cbnz", class: "cbz_cbnz", opc: 0b0110101, desc: "if (Rt != 0) PC = PC + offset" },
  { name: "add", class: "addsub_imm", opc: 0b00100010, desc: "Rd = Rn + imm" },
  { name: "sub", class: "addsub_imm", opc: 0b10100010, desc: "Rd = Rn - imm" },
  { name: "and", class: "logical_imm", opc: 0b00100100, desc: "Rd = Rn & imm" },
  { name: "orr", class: "logical_imm", opc: 0b01100100, desc: "Rd = Rn | imm" },
  { name: "eor", class: "logical_imm", opc: 0b10100100, desc: "Rd = Rn ^ imm" },
  { name: "movn", class: "movewide", opc: 0b00100101, desc: "Rd = ~(imm16 << shift)" },
  { name: "movz", class: "movewide", opc: 0b10100101, desc: "Rd = imm16 << shift" },
  { name: "movk", class: "movewide", opc: 0b11100101, desc: "Rd[shift+15:shift] = imm16" },
  { name: "add", class: "addsub_reg", opc: 0b0001011, desc: "Rd = Rn + shift(Rm)" },
  { name: "sub", class: "addsub_reg", opc: 0b1001011, desc: "Rd = Rn - shift(Rm)" },
  { name: "and", class: "logical_reg", opc: 0b0001010, desc: "Rd = Rn & shift(Rm)" },
  { name: "orr", class: "logical_reg", opc: 0b0101010, desc: "Rd = Rn | shift(Rm)" },
  { name: "eor", class: "logical_reg", opc: 0b1001010, desc: "Rd = Rn ^ shift(Rm)" },
  { name: "strb", class: "ldst_imm", size: 0b00, opc2: 0b00, desc: "M8[Rn + imm] = Rt[7:0]" },
  { name: "ldrb", class: "ldst_imm", size: 0b00, opc2: 0b01, desc: "Rt = ZeroExtend(M8[Rn + imm])" },
  { name: "strh", class: "ldst_imm", size: 0b01, opc2: 0b00, desc: "M16[Rn + imm] = Rt[15:0]" },
  { name: "ldrh", class: "ldst_imm", size: 0b01, opc2: 0b01, desc: "Rt = ZeroExtend(M16[Rn + imm])" },
  { name: "str", class: "ldst_imm", size: 0b10, opc2: 0b00, desc: "M32[Rn + imm] = Wt" },
  { name: "ldr", class: "ldst_imm", size: 0b10, opc2: 0b01, desc: "Wt = M32[Rn + imm]" },
  { name: "str", class: "ldst_imm", size: 0b11, opc2: 0b00, desc: "M64[Rn + imm] = Xt" },
  { name: "ldr", class: "ldst_imm", size: 0b11, opc2: 0b01, desc: "Xt = M64[Rn + imm]" },
];

// find looks an instruction up by class and the fields that name it. Every
// class but ldst_imm is named by its opc value alone; ldst_imm additionally
// needs size, since the same STR/LDR opc bits (the low 2 of its 8 bit opc
// field) mean a different width instruction at each of the four sizes.
//
// Two classes carry a field outside opc that still changes which real
// instruction the word is, and has to be checked before opc is trusted:
// addsub_reg's shiftop packs shift-type(2) and a bit that, when set, means
// the word is really the (out of scope) extended-register form sharing the
// same 01011 marker — same shape as RISC-V's shift hiding funct7 in imm7.
// logical_reg's N bit, when set, negates Rm and turns AND/ORR/EOR into the
// (out of scope) BIC/ORN/EON — the opc bits alone do not say so.
export function find(cls, fields) {
  if (cls === "ldst_imm") {
    const opc2 = fields.opc & 0b11;
    return INSTRUCTIONS.find((i) => i.class === cls && i.size === fields.size && i.opc2 === opc2) || null;
  }
  if (cls === "addsub_reg" && (fields.shiftop & 0b001) !== 0) return null; // extended-register form
  if (cls === "addsub_reg" && (fields.shiftop >> 1) === 0b11) return null; // reserved shift type
  if (cls === "logical_reg" && fields.n !== 0) return null; // BIC/ORN/EON/BICS
  return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc) || null;
}

// --- Registers -------------------------------------------------------------

// regName spells a register field out. Rn/Rd of the add/sub families read 31
// as SP when the instruction does not set flags (S=0); everywhere else,
// 31 is the zero register.
export function regName(n, sf, sp) {
  const width = sf ? "x" : "w";
  if (n === 31) return sp ? "sp" : (sf ? "xzr" : "wzr");
  return `${width}${n}`;
}

// --- Condition codes ---------------------------------------------------

export const CONDITIONS = [
  ["eq", "Z == 1", "equal"],
  ["ne", "Z == 0", "not equal"],
  ["cs", "C == 1", "carry set / unsigned higher or same"],
  ["cc", "C == 0", "carry clear / unsigned lower"],
  ["mi", "N == 1", "negative"],
  ["pl", "N == 0", "positive or zero"],
  ["vs", "V == 1", "signed overflow"],
  ["vc", "V == 0", "no signed overflow"],
  ["hi", "C == 1 && Z == 0", "unsigned higher"],
  ["ls", "!(C == 1 && Z == 0)", "unsigned lower or same"],
  ["ge", "N == V", "signed greater or equal"],
  ["lt", "N != V", "signed less than"],
  ["gt", "Z == 0 && N == V", "signed greater than"],
  ["le", "!(Z == 0 && N == V)", "signed less or equal"],
  ["al", "true", "always"],
  ["nv", "true", "always (reserved encoding)"],
];

export const condName = (n) => CONDITIONS[n]?.[0] || `cond${n}`;

// --- Immediates ----------------------------------------------------------

// signExtend reads a width bit two's complement field as a signed number.
export function signExtend(value, width) {
  const sign = 1 << (width - 1);
  return (value & (sign - 1)) - (value & sign);
}

// branchOffset is the byte offset a branch's word-aligned immediate stands
// for: the field counts words, not bytes, so the reach is 4x the bit count.
export function branchOffset(imm, width) {
  return signExtend(imm, width) * 4;
}

// decodeBitMasks turns AArch64's N:immr:imms bitmask-immediate encoding into
// the actual value AND/ORR/EOR (immediate) operate with — the same algorithm
// the architecture's own pseudocode (DecodeBitMasks) uses: find the smallest
// repeating element these three fields describe, build a run of ones the
// width imms picks, rotate it by immr, then tile it across the register.
// Returns a BigInt, since a 64 bit pattern does not fit in a JS number, or
// throws when N/immr/imms do not encode a valid bitmask (the architecture
// reserves several combinations, notably an all-ones element).
export function decodeBitMasks(n, immr, imms, datasize) {
  const combined = (n << 6) | (~imms & 0x3f);
  // Highest set bit of the 7 bit value above (Math.clz32 counts leading
  // zeros over a 32 bit word, so undo that offset); -1 when combined is 0.
  const hi = 31 - Math.clz32(combined);
  if (hi < 1) throw new Error("N:immr:imms is a reserved bitmask immediate (no element size fits)");
  const e = 1 << hi; // element size
  if (e > datasize) throw new Error(`N:immr:imms asks for a ${e} bit element, too wide for a ${datasize} bit register`);
  const levels = e - 1;
  const s = imms & levels;
  const r = immr & levels;
  if (s === levels) throw new Error("N:immr:imms is reserved (an all-ones element would be a no-op mask)");

  const ones = (1n << BigInt(s + 1)) - 1n; // s+1 ones, at the bottom of an e bit field
  const eMask = (1n << BigInt(e)) - 1n;
  const rotated = r === 0 ? ones : ((ones >> BigInt(r)) | (ones << BigInt(e - r))) & eMask;

  let wmask = 0n;
  for (let i = 0; i < datasize; i += e) wmask |= rotated << BigInt(i);
  return wmask & ((1n << BigInt(datasize)) - 1n);
}

// hexNum formats a plain number or BigInt the same way, since
// decodeBitMasks hands back a BigInt but most other fields are plain numbers.
export const hexNum = (n) => "0x" + n.toString(16).toUpperCase();
