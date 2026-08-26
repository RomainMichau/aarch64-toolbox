// The tool descriptors: static data describing what each tool shows.
//
// The instruction tables are not written out here — they are built from the
// same INSTRUCTIONS/CLASSES tables the encoder and the decoder read, so the
// reference and the answers can never drift apart.

import * as a from "./tools/aarch64.js";
import { extractSendableAarch64 } from "./tools/decode.js";
import { NUMBER_TOOL } from "./tools/number.js";

const bin = (n, width) => (n >>> 0).toString(2).padStart(width, "0");

// The colours a field wears, shared by the encoder's boxes and the reference
// layouts, the same convention riscv_toolbox uses.
const COLOR = {
  class: "muted",
  opc: "red",
  mode: "orange", // sf, sh, hw, shift/shiftop, N, size, o0 — the modifier bits
  rd: "yellow",
  rn: "green",
  rm: "blue",
  imm: "purple",
};

// Which colour (and, for the layout diagrams, which single letter) each
// field id wears. Every CLASSES layout in aarch64.js is built entirely out
// of these ids, so this one table drives the encoder's segment colours, the
// doc's layout diagrams and its legend alike.
const FIELD = {
  class: { letter: "c", label: "class", color: COLOR.class },
  opc: { letter: "o", label: "opc", color: COLOR.opc },
  sf: { letter: "f", label: "sf", color: COLOR.mode },
  sh: { letter: "h", label: "sh", color: COLOR.mode },
  hw: { letter: "w", label: "hw", color: COLOR.mode },
  size: { letter: "z", label: "size", color: COLOR.mode },
  shiftop: { letter: "x", label: "shift/ext", color: COLOR.mode },
  shift: { letter: "x", label: "shift", color: COLOR.mode },
  n: { letter: "n", label: "N", color: COLOR.mode },
  o0: { letter: "0", label: "o0", color: COLOR.mode },
  cond: { letter: "d", label: "cond", color: COLOR.imm },
  imm26: { letter: "i", label: "imm26", color: COLOR.imm },
  imm19: { letter: "i", label: "imm19", color: COLOR.imm },
  imm16: { letter: "i", label: "imm16", color: COLOR.imm },
  imm12: { letter: "i", label: "imm12", color: COLOR.imm },
  imm6: { letter: "i", label: "imm6", color: COLOR.imm },
  immr: { letter: "r", label: "immr", color: COLOR.imm },
  imms: { letter: "m", label: "imms", color: COLOR.imm },
  rd: { letter: "D", label: "rd", color: COLOR.rd },
  rn: { letter: "N", label: "rn", color: COLOR.rn },
  rm: { letter: "M", label: "rm", color: COLOR.rm },
  rt: { letter: "T", label: "rt", color: COLOR.rd },
};

const LAYOUT_COLORS = Object.fromEntries(Object.values(FIELD).map((f) => [f.letter, f.color]));

// seg is one box of the encoder row: the field it edits, how wide it is, and
// the colour it shares with the reference.
const seg = (id, width) => ({ id, label: FIELD[id]?.label || id, width, color: FIELD[id]?.color || "muted" });

const layoutText = (fields) => fields.map(([id, spec]) => FIELD[id].letter.repeat(spec.width)).join(" ");

const layoutDoc = (title, cls, note) => [
  { title, kind: "layout", text: layoutText(a.layout(cls)), colors: LAYOUT_COLORS },
  ...(note ? [{ kind: "note", text: note }] : []),
];

// instRows turns instruction entries into reference rows, one per class.
const instRows = (cls) => a.INSTRUCTIONS.filter((i) => i.class === cls).map((i) => {
  const opcWidth = a.layout(cls).find(([id]) => id === "opc")?.[1].width;
  const opcText = cls === "ldst_imm"
    ? `size ${bin(i.size, 2)} · opc ${bin(i.opc2, 2)}`
    : bin(i.opc, opcWidth);
  return [i.name, opcText, i.desc, i.note || ""];
});

const instGrid = (cls, opcLabel) => ({
  kind: "grid",
  columns: [
    { label: "Inst", mono: true },
    { label: opcLabel, mono: true, color: COLOR.opc },
    { label: "Effect", mono: true },
    { label: "Note", color: "muted" },
  ],
  rows: instRows(cls),
});

// The class box's 4 bit values, in CLASS_KEYS order — what the variants
// below switch the segmented row on.
const CLASS_BITS = a.CLASS_KEYS.map((_, i) => i.toString(2).padStart(4, "0"));

const CLASS_SEG = seg("class", 4);

const classInputs = (cls) => [CLASS_SEG, ...a.layout(cls).map(([id, spec]) => seg(id, spec.width))];

export const TOOLS = [
  NUMBER_TOOL,
  {
    id: "aarch64-doc",
    name: "Instruction Doc",
    family: "AArch64",
    description: "The nine word layouts in scope, the registers, the condition codes, and every instruction this toolbox knows — one fold per part.",
    doc: [
      {
        title: "Scope",
        kind: "note",
        text: "A reasonable core, the way riscv_toolbox scopes itself to RV32I+M+A: data-processing (immediate) — ADD/SUB/AND/ORR/EOR and MOVZ/MOVN/MOVK immediate forms; data-processing (register) — ADD/SUB/AND/ORR/EOR shifted-register forms; branches — B, BL, B.cond, CBZ/CBNZ; loads/stores — LDR/STR with an unsigned immediate offset, at all four sizes (byte, halfword, word, doubleword). Every field is real AArch64; what is left out (ADDS/SUBS/ANDS, BIC/ORN/EON, the extended-register add/sub form, pre/post-indexed and PC-relative loads, SIMD/FP) still classifies correctly below, it just has no named instruction — same as an opcode riscv_toolbox's card does not list.",
      },
      {
        title: "Word layouts",
        kind: "group",
        text: "Every AArch64 instruction is a 32 bit word, but unlike RISC-V there is no single opcode field that names the layout — different classes keep their identifying bits at different positions and widths. This toolbox's encoder adds a class box (grey, leftmost) to pick one; it is not part of the real word, only of the boxes — see the note under Fields.",
        sections: [
          ...layoutDoc("B, BL — unconditional branch", "b_bl",
            "opc is bit 31 (0=B, 1=BL) over the fixed 00101. imm26 is a word count: the byte offset is imm26 × 4, sign extended, giving a ±128 MiB reach."),
          ...layoutDoc("B.cond — conditional branch", "b_cond",
            "opc is fixed (01010100). imm19 is a word count the same way imm26 is. o0 is always 0 here; o0=1 is BC.cond, a later addition out of scope."),
          ...layoutDoc("CBZ, CBNZ — compare and branch", "cbz_cbnz",
            "opc is 011010 with the low bit as CBZ/CBNZ. Rt is compared to 0, not stored to — width follows sf like every other register field."),
          ...layoutDoc("ADD, SUB — immediate", "addsub_imm",
            "opc packs op (0=ADD,1=SUB), S (flags — always 0 in scope) and the fixed 100010. imm12 is shifted left 12 first when sh is set."),
          ...layoutDoc("AND, ORR, EOR — immediate", "logical_imm",
            "opc packs a 2 bit opc (00/01/10 = AND/ORR/EOR; 11 = ANDS, out of scope) and the fixed 100100. N, immr and imms together encode a bitmask immediate — see the note below."),
          ...layoutDoc("MOVZ, MOVN, MOVK — move wide immediate", "movewide",
            "opc packs a 2 bit opc (00/10/11 = MOVN/MOVZ/MOVK; 01 is reserved) and the fixed 100101. hw × 16 is the shift imm16 is placed at."),
          ...layoutDoc("ADD, SUB — shifted register", "addsub_reg",
            "opc packs op, S (always 0 in scope) and the fixed 01011. shiftop packs the 2 bit shift type over a bit that is 0 here — 1 means this is really the (out of scope) extended-register form sharing the same marker."),
          ...layoutDoc("AND, ORR, EOR — shifted register", "logical_reg",
            "opc packs a 2 bit opc and the fixed 01010. N negates Rm when set, turning AND/ORR/EOR into BIC/ORN/EON — out of scope, so N must be 0 here."),
          ...layoutDoc("LDR, STR — immediate, unsigned offset", "ldst_imm",
            "size picks the width (00/01/10/11 = byte/halfword/word/doubleword). opc packs the fixed 111001 with 00=STR, 01=LDR (10/11 are the signed loads, out of scope). The byte offset is imm12 × the size in bytes."),
          {
            title: "Fields",
            kind: "legend",
            rows: [
              { key: "c", value: "class — picks the layout below. A toolbox-only box: real AArch64 has no single field that plays this role the way RISC-V's opcode does, so it is not packed into the word (see Hex/Bits, always 32 bits)", color: COLOR.class },
              { key: "o", value: "opc — the bits that, together with class, name the instruction", color: COLOR.opc },
              { key: "f/h/w/z/x/n/0", value: "sf, sh, hw, size, shift/ext bits, N, o0 — modifiers: register width, immediate shift, access size, and the rest", color: COLOR.mode },
              { key: "D", value: "rd — destination register", color: COLOR.rd },
              { key: "T", value: "rt — the loaded/stored register (LDR/STR/CBZ/CBNZ)", color: COLOR.rd },
              { key: "N", value: "rn — first source register, or the load/store base", color: COLOR.rn },
              { key: "M", value: "rm — second source register (shifted-register forms only)", color: COLOR.rm },
              { key: "i/r/m/d", value: "imm26, imm19, imm16, imm12, imm6, immr, imms, cond — the immediate, wherever this layout keeps it", color: COLOR.imm },
            ],
          },
          {
            kind: "note",
            text: "Every layout is written most significant bit first, bit 31 on the left, in the same colours the encoder paints its boxes.",
          },
          {
            kind: "note",
            text: "AND/ORR/EOR (immediate)'s N:immr:imms is not a plain field — it is AArch64's bitmask-immediate encoding, the same DecodeBitMasks algorithm real hardware uses: find the smallest power-of-two element N:immr:imms describes, lay imms+1 ones into it, rotate by immr, then tile the element across the register. The encoder and decoder here both run it and report the actual hex value; the boxes still hold N/immr/imms raw, the way riscv_toolbox's imm7 holds a shift's raw funct7 rather than its meaning.",
          },
        ],
      },
      {
        title: "Registers",
        kind: "group",
        text: "31 general-purpose registers, addressed as x0-x30 (64 bit) or w0-w30 (32 bit, the low half) depending on sf. Register 31 is context dependent: the zero register (xzr/wzr) almost everywhere, but the stack pointer (sp) for rn and rd of the add/sub families — never for rm, and never for a plain register operand like CBZ's rt or a logical instruction's operands.",
        sections: [
          {
            kind: "grid",
            columns: [
              { label: "Field", mono: true },
              { label: "Classes", mono: true },
              { label: "31 reads as", mono: true, color: COLOR.rd },
            ],
            rows: [
              ["rn, rd", "ADD/SUB (immediate, register)", "sp"],
              ["rd", "AND/ORR/EOR (imm/reg), MOVZ/MOVN/MOVK", "xzr / wzr"],
              ["rn, rm", "AND/ORR/EOR (register)", "xzr / wzr"],
              ["rn", "LDR/STR — the base register", "sp"],
              ["rt", "LDR/STR, CBZ/CBNZ", "xzr / wzr"],
            ],
          },
          {
            kind: "note",
            text: "x30 doubles as the link register: BL writes the return address there, and `ret` (jalr's AArch64 counterpart, out of this toolbox's branch scope) reads it back.",
          },
        ],
      },
      {
        title: "Condition codes",
        kind: "group",
        text: "B.cond's 4 bit cond field, tested against the N/Z/C/V flags. 14 are real conditions; 1110 and 1111 both mean \"always\" (the second is a reserved encoding of it).",
        sections: [
          {
            kind: "grid",
            columns: [
              { label: "cond", mono: true },
              { label: "Suffix", mono: true, color: COLOR.imm },
              { label: "Flags", mono: true },
              { label: "Meaning" },
            ],
            rows: a.CONDITIONS.map(([suffix, flags, meaning], n) => [bin(n, 4), `b.${suffix}`, flags, meaning]),
          },
        ],
      },
      {
        title: "B / BL",
        kind: "group",
        text: "Unconditional branches. imm26 is a word count: PC += imm26 × 4 (sign extended).",
        sections: [instGrid("b_bl", "opc")],
      },
      {
        title: "CBZ / CBNZ",
        kind: "group",
        text: "Branch on whether a register is zero — the closest thing in scope to a one-instruction \"if\".",
        sections: [instGrid("cbz_cbnz", "opc")],
      },
      {
        title: "ADD / SUB (immediate)",
        kind: "group",
        text: "",
        sections: [instGrid("addsub_imm", "opc")],
      },
      {
        title: "AND / ORR / EOR (immediate)",
        kind: "group",
        text: "",
        sections: [instGrid("logical_imm", "opc")],
      },
      {
        title: "MOVZ / MOVN / MOVK",
        kind: "group",
        text: "Build a register up 16 bits at a time. MOVZ zeroes the rest, MOVN complements the rest (so MOVN with hw=0 alone can produce any small negative value), MOVK leaves the rest alone — the usual way to load a 64 bit constant is one MOVZ followed by up to three MOVKs.",
        sections: [instGrid("movewide", "opc")],
      },
      {
        title: "ADD / SUB (register)",
        kind: "group",
        text: "",
        sections: [instGrid("addsub_reg", "opc")],
      },
      {
        title: "AND / ORR / EOR (register)",
        kind: "group",
        text: "`mov rd, rm` is really `orr rd, xzr/wzr, rm` with no shift — there is no dedicated MOV opcode for register-to-register moves.",
        sections: [instGrid("logical_reg", "opc")],
      },
      {
        title: "LDR / STR (immediate)",
        kind: "group",
        text: "The unsigned-offset form: imm12 always scales by the access size, and is never negative. Pre/post-indexed addressing and PC-relative literal loads are different encodings, out of scope.",
        sections: [instGrid("ldst_imm", "size · opc")],
      },
    ],
  },
  {
    id: "aarch64-encode",
    name: "Instruction Encoder",
    family: "AArch64",
    description: "Pick a class in the leftmost box and the row changes shape to match. Every other box is real AArch64; the class box is this toolbox's own, since AArch64 has no single opcode field to type instead — see the Instruction Doc.",
    inputs: classInputs(a.CLASS_KEYS[0]),
    variants: a.CLASS_KEYS.map((cls, i) => ({
      when: { input: "class", equals: CLASS_BITS[i] },
      inputs: classInputs(cls),
    })),
  },
  {
    id: "aarch64-decode",
    name: "Instruction Decoder",
    family: "AArch64",
    description: "Read a word back into its fields. Letters stand for variables, so a pattern like 100osssssnnnnnddddd works as well as plain bits — the class is worked out from the bits that are known, same as the opcode is for RISC-V.",
    sendTo: "aarch64-encode",
    sendLabel: "Edit in encoder →",
    extractSendable: extractSendableAarch64,
    inputs: [
      { id: "word", placeholder: "1001000100000000000101000000000", format: "bits" },
      {
        id: "read",
        label: "Read as",
        kind: "choice",
        options: [
          { id: "bits", label: "Bits" },
          { id: "number", label: "Number" },
          { id: "hex", label: "Hex" },
        ],
        value: "bits",
      },
    ],
  },
];
