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
  // Added for the integer-core-and-atomics expansion — grouped the same way
  // as above: generic immediates share "i", registers share their role's
  // letter, everything else is a class-specific modifier/marker bit.
  imm3: { letter: "i", label: "imm3", color: COLOR.imm },
  imm7: { letter: "i", label: "imm7", color: COLOR.imm },
  imm9: { letter: "i", label: "imm9", color: COLOR.imm },
  imm14: { letter: "i", label: "imm14", color: COLOR.imm },
  immhi: { letter: "i", label: "immhi", color: COLOR.imm },
  immlo: { letter: "i", label: "immlo", color: COLOR.imm },
  lsb: { letter: "i", label: "lsb", color: COLOR.imm },
  nzcv: { letter: "i", label: "nzcv", color: COLOR.imm },
  rt2: { letter: "T", label: "rt2", color: COLOR.rd },
  rm_imm: { letter: "M", label: "rm / imm5", color: COLOR.rm },
  rs: { letter: "S", label: "rs", color: COLOR.rm },
  ra: { letter: "a", label: "ra", color: COLOR.rn },
  a: { letter: "A", label: "A", color: COLOR.mode },
  b5: { letter: "5", label: "b5", color: COLOR.mode },
  b40: { letter: "6", label: "b40", color: COLOR.mode },
  crm: { letter: "K", label: "CRm", color: COLOR.mode },
  crn: { letter: "U", label: "CRn", color: COLOR.mode },
  fixed: { letter: ".", label: "(fixed)", color: COLOR.class },
  fixed1: { letter: ":", label: "(fixed)", color: COLOR.class },
  fixed10: { letter: ";", label: "(fixed)", color: COLOR.class },
  vfixed: { letter: ",", label: "(fixed)", color: COLOR.class },
  flag: { letter: "?", label: "reg/imm", color: COLOR.mode },
  idx: { letter: "j", label: "idx", color: COLOR.mode },
  l: { letter: "L", label: "L", color: COLOR.mode },
  ll: { letter: "2", label: "LL", color: COLOR.mode },
  o1: { letter: "1", label: "o1", color: COLOR.mode },
  o2: { letter: "9", label: "o2", color: COLOR.mode },
  o3: { letter: "3", label: "o3", color: COLOR.mode },
  o4: { letter: "8", label: "o4", color: COLOR.mode },
  one21: { letter: "e", label: "(fixed 1)", color: COLOR.class },
  one30: { letter: "e", label: "(fixed 1)", color: COLOR.class },
  zero21: { letter: "q", label: "(fixed 0)", color: COLOR.class },
  zero30: { letter: "q", label: "(fixed 0)", color: COLOR.class },
  op: { letter: "b", label: "op", color: COLOR.mode },
  op2: { letter: "g", label: "op2", color: COLOR.mode },
  op21: { letter: "k", label: "op21", color: COLOR.mode },
  op3: { letter: "7", label: "op3", color: COLOR.mode },
  op31: { letter: "y", label: "op31", color: COLOR.mode },
  op4: { letter: "4", label: "op4", color: COLOR.mode },
  op54: { letter: "u", label: "op54", color: COLOR.mode },
  opc2: { letter: "Q", label: "opc2", color: COLOR.mode },
  opcode: { letter: "O", label: "opcode", color: COLOR.mode },
  opcode2: { letter: "P", label: "opcode2", color: COLOR.mode },
  opt: { letter: "t", label: "opt", color: COLOR.mode },
  option: { letter: "p", label: "option", color: COLOR.mode },
  r: { letter: "R", label: "R", color: COLOR.mode },
  s: { letter: "s", label: "S", color: COLOR.mode },
  v: { letter: "V", label: "V", color: COLOR.mode },
  z: { letter: "Z", label: "Z", color: COLOR.mode },
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

// KEY_FIELDS lists, per class, which of an INSTRUCTIONS row's own fields
// name the instruction — the same fields each family module's find() reads
// (see aarch64/*.js). Classes not listed here (ldst_imm) get their own
// special-cased column instead, the way they did before this table existed.
const KEY_FIELDS = {
  addsub_imm: ["opc"], logical_imm: ["opc"], movewide: ["opc"], bitfield: ["opc"],
  extract: [], pcrel: ["op"],
  addsub_reg: ["opc"], addsub_ext: ["opc"], logical_reg: ["opc", "n"],
  condselect: ["op", "op2"], condcompare: ["op"], dp2src: ["opcode"],
  dp1src: ["opcode", "sfOnly"], dp3src: ["op31", "o0", "sfOnly"],
  b_bl: ["opc"], b_cond: ["opc"], cbz_cbnz: ["opc"], tbz_tbnz: ["op"],
  br_reg: ["op"],
  ldst_unscaled: ["size", "opc2", "idx"], ldst_regoffset: ["size", "opc2"],
  ldst_pair: ["opc", "idx", "l"], ldst_excl: ["o2", "o1", "o0", "l"],
  ldst_literal: ["opc"], atomic_ldop: ["opc", "a", "r", "size"],
  sysmisc: ["crn", "crm", "op2"], excgen: ["opc", "ll"],
};

// instRows turns instruction entries into reference rows, one per class.
const instRows = (cls) => a.INSTRUCTIONS.filter((i) => i.class === cls).map((i) => {
  const opcWidth = a.layout(cls).find(([id]) => id === "opc")?.[1].width;
  const keyText = cls === "ldst_imm"
    ? `size ${bin(i.size, 2)} · opc ${bin(i.opc2, 2)}`
    : cls in KEY_FIELDS
    ? KEY_FIELDS[cls].filter((id) => i[id] !== undefined).map((id) => `${id}=${i[id]}`).join(" · ")
    : bin(i.opc, opcWidth);
  return [i.name, keyText, i.desc, i.note || ""];
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

// The class box's bit values, in CLASS_KEYS order — what the variants below
// switch the segmented row on. CLASS_SELECTOR_WIDTH (not a hardcoded 4) is
// how wide that box needs to be now that there are 28 classes, not 9.
const CLASS_BITS = a.CLASS_KEYS.map((_, i) => i.toString(2).padStart(a.CLASS_SELECTOR_WIDTH, "0"));

const CLASS_SEG = seg("class", a.CLASS_SELECTOR_WIDTH);

const classInputs = (cls) => [CLASS_SEG, ...a.layout(cls).map(([id, spec]) => seg(id, spec.width))];

export const TOOLS = [
  NUMBER_TOOL,
  {
    id: "aarch64-doc",
    name: "Instruction Doc",
    family: "AArch64",
    description: "The 28 word layouts in scope, the registers, the condition codes, and every instruction this toolbox knows — one fold per part.",
    doc: [
      {
        title: "Scope",
        kind: "note",
        text: "The integer core and atomics a modern CPU needs for general-purpose, non-numeric code — everything a compiler emits for ordinary C/C++ that is not floating point, SIMD/vector, SVE, or system-register access (MRS/MSR): every integer data-processing family (immediate and register, including bitfield/extract, conditional select/compare, multiply/divide, shifts, and the register-count \"1/2/3-source\" families), every branch shape (PC-relative, register-indirect, compare/test-and-branch), the full load/store surface (unsigned/unscaled/indexed/register-offset/pair/exclusive/ordered/literal, signed loads included), barriers and the common hints, SVC/BRK/HLT, and the LSE atomics (CAS and the LDADD-shaped read-modify-writes, plus SWP). 28 classes, 244 named instruction forms in all — up from the original 9-class, 24-instruction core. Every field below is real AArch64; a handful of reserved sibling encodings (byte/halfword exclusive and CAS forms, the SIMD/FP-register load/store pair opc value, and so on) still classify correctly, they just have no named instruction, the same restraint the original core already applied to ADDS/SUBS/ANDS.",
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
            "size picks the width (00/01/10/11 = byte/halfword/word/doubleword). opc packs the fixed 111001 with a 2 bit opc2 (00/01=STR/LDR, 10/11=the signed loads LDRSB/H/W). The byte offset is imm12 × the size in bytes."),
          ...layoutDoc("SBFM, BFM, UBFM — bitfield move", "bitfield",
            "opc (00/01/10 = SBFM/BFM/UBFM) over the fixed 100110. Shown under whichever alias applies — SXTB/SXTH/SXTW, LSL/LSR/ASR, BFI/BFXIL, SBFIZ/SBFX/UBFIZ/UBFX — see the note below the Registers group."),
          ...layoutDoc("EXTR", "extract",
            "The fixed 100111 over op21 (must be 00) and o0 (must be 0) — the reserved siblings of this same marker. lsb is the rotation point Rd's low bits start at, reading up through Rn:Rm. Shown as ROR when Rm and Rn are the same register."),
          ...layoutDoc("ADR, ADRp — PC-relative address", "pcrel",
            "op (bit 31, 0=ADR, 1=ADRP) over the fixed 10000. immhi:immlo is a scrambled 21 bit signed immediate — ADR adds it directly, ADRP shifts it left 12 first and clears PC's low 12 bits before adding."),
          ...layoutDoc("ADD, SUB — extended register", "addsub_ext",
            "Shares addsub_reg's op/S/01011 marker; bit 21 (1 here, 0 there) tells the two apart. option picks an extend type (UXTB/H/W/X, SXTB/H/W/X) applied to Rm before the shift-by-0..4 in imm3 — the pointer-arithmetic form, e.g. `add x0, x1, w2, uxtw #2`."),
          ...layoutDoc("CSEL, CSINC, CSINV, CSNEG — conditional select", "condselect",
            "op/op2 (2 bits combined) pick the four names over the fixed 11010100. CSET/CSETM/CINC/CINV/CNEG are all this instruction, named by how rm relates to rn and to 11111 — see the note below."),
          ...layoutDoc("CCMP, CCMN — conditional compare", "condcompare",
            "op (0/1 = CCMN/CCMP) over the fixed 11010010. flag (bit 11) picks whether rm_imm is Rm or a 5 bit unsigned immediate. nzcv is the flags value used when cond is false."),
          ...layoutDoc("LSLV, LSRV, ASRV, RORV, SDIV, UDIV", "dp2src",
            "opcode (6 bits) over the fixed 11010110 with bit 30 clear (set, at the same marker, is dp1src below). These are the *register*-shift instructions — LSL/LSR/ASR/ROR's immediate forms are bitfield aliases, a different class entirely."),
          ...layoutDoc("RBIT, REV16, REV, REV32, CLZ, CLS", "dp1src",
            "opcode over the fixed 11010110 with bit 30 set. opcode2 must be 00000 — every other value is a reserved sibling. REV vs REV32 at opcode 000010 is told apart by sf alone."),
          ...layoutDoc("MADD, MSUB, S/UMADDL, S/UMSUBL, S/UMULH", "dp3src",
            "op31/o0 pick the eight names over the fixed 11011. MUL/MNEG/SMULL/SMNEGL/UMULL/UMNEGL are all this instruction with Ra=11111 — see the note below."),
          ...layoutDoc("TBZ, TBNZ — test bit and branch", "tbz_tbnz",
            "b5:b40 is a scrambled 6 bit bit-number — b5 alone also picks W (0) or X (1) for Rt, since a bit position of 32 or above only exists in a 64 bit register. imm14 is a word count, ±32 KiB reach."),
          ...layoutDoc("BR, BLR, RET — branch to register", "br_reg",
            "op (2 bits: 00/01/10 = BR/RET/BLR) over the fixed 1101011 with Z and A (pointer authentication) both fixed 0. RET shows no operand when Rn is the default x30."),
          ...layoutDoc("LDUR, STUR, and pre/post-indexed LDR/STR", "ldst_unscaled",
            "Shares ldst_imm's size/opc2 table through a 9 bit signed imm9 instead of a scaled imm12. idx (00/01/11) picks unscaled-no-writeback (the LDUR/STUR spelling), post-indexed, or pre-indexed addressing; 10 is the unprivileged LDTR/STTR family, out of scope."),
          ...layoutDoc("LDR, STR — register offset", "ldst_regoffset",
            "Same size/opc2 table again, addressed as [Rn, Rm, extend #amount] instead of an immediate. option picks the extend type (UXTW/LSL/SXTW/SXTX only — the other four are reserved), S picks shift-by-0 or shift-by-the-access-size."),
          ...layoutDoc("LDP, STP — load/store pair", "ldst_pair",
            "opc (00/10 = W/X pair; 01 is a SIMD/FP pair, out of scope) and L (0/1 = store/load) over the fixed 101. idx (001/010/011 = post-indexed/plain/pre-indexed) picks addressing the same way ldst_unscaled's does; 000 is the non-temporal STNP/LDNP, out of scope."),
          ...layoutDoc("LDXR/STXR, LDAXR/STLXR, LDAR/STLR, CAS family", "ldst_excl",
            "One real encoding group for exclusive, ordered, and compare-and-swap access, told apart by o2/o1/o0/L — see the note below. Byte/halfword-sized forms (size 00/01) classify but are not named, the same trim ADDS/SUBS/ANDS gets in the original core."),
          ...layoutDoc("LDR — literal (PC-relative)", "ldst_literal",
            "opc (00/01/10 = LDR Wt/LDR Xt/LDRSW Xt; 11 is PRFM, out of scope) over the fixed 011000. imm19 is a word count, the same convention every other PC-relative field in this toolbox uses."),
          ...layoutDoc("LDADD/LDCLR/LDEOR/LDSET/LDSMAX/LDSMIN/LDUMAX/LDUMIN, SWP", "atomic_ldop",
            "Shares ldst_unscaled/regoffset's outer marker; bit 21 = 1 tells it apart from ldst_unscaled (0), and bits 11:10 = 00 tell it apart from ldst_regoffset (10) in turn. opc (4 bits) picks the operation; A and R are independent acquire/release flags, giving every op four ordering spellings (plain, ...L, ...A, ...AL)."),
          ...layoutDoc("Hints (NOP, YIELD, WFE, WFI, SEV, SEVL), DMB, DSB, ISB", "sysmisc",
            "CRn (0010 vs 0011) tells hints from barriers apart within the same fixed 0xD503 prefix; op2 then picks which one. Rt is fixed 11111 throughout — none of these touch a general-purpose register."),
          ...layoutDoc("SVC, BRK, HLT", "excgen",
            "opc/LL over the fixed 0xD4 pick the three; opc2 (bits 4:2) is fixed 000 for all of them. imm16 is a plain immediate — a syscall number for SVC, a debugger-defined value for BRK/HLT."),
          {
            title: "Fields",
            kind: "legend",
            rows: [
              { key: "c", value: "class — picks the layout below. A toolbox-only box: real AArch64 has no single field that plays this role the way RISC-V's opcode does, so it is not packed into the word (see Hex/Bits, always 32 bits)", color: COLOR.class },
              { key: "o/O/P", value: "opc, opcode, opcode2 — the bits that, together with class, name the instruction", color: COLOR.opc },
              { key: "f/h/w/z/x/n/0", value: "sf, sh, hw, size, shift/ext bits, N, o0 — modifiers: register width, immediate shift, access size, and the rest", color: COLOR.mode },
              { key: "1/9/3/8/e/q", value: "o1, o2, o3, o4, one21/one30, zero21/zero30 — bits fixed at a single value for the whole class, shown anyway so no bit of the word is left unaccounted for", color: COLOR.class },
              { key: "./,/:/;", value: "fixed, vfixed, fixed1, fixed10 — a whole class's own constant marker, shown the same way", color: COLOR.class },
              { key: "b/g/k/y/u/7/4/2", value: "op, op2, op21, op31, op54, op3, op4, LL — the extra selector bits some classes need beyond their opc (see find() in aarch64/*.js for exactly which)", color: COLOR.mode },
              { key: "5/6", value: "b5, b40 — TBZ/TBNZ's scrambled 6 bit bit-number", color: COLOR.mode },
              { key: "j/L/?/t/p/s/A/R/U/K", value: "idx, L, flag, opt, option, S, A, R, CRn, CRm — every other class-specific modifier (addressing mode, extend type, ordering, and so on)", color: COLOR.mode },
              { key: "D/a", value: "rd, ra — destination register, or the accumulate/third operand for MADD-shaped multiplies", color: COLOR.rd },
              { key: "T", value: "rt, rt2 — the loaded/stored register(s) (LDR/STR/CBZ/CBNZ/LDP-STP/...)", color: COLOR.rd },
              { key: "N", value: "rn — first source register, or the load/store base", color: COLOR.rn },
              { key: "M/S", value: "rm, rm_imm, rs — second/third register operand (shifted/extended-register and load/store-exclusive/atomic forms)", color: COLOR.rm },
              { key: "i", value: "every plain immediate this toolbox has (imm26 down to imm3, immhi/immlo, lsb, nzcv) and cond — the immediate or condition, wherever this layout keeps it", color: COLOR.imm },
              { key: "r/m", value: "immr, imms — AND/ORR/EOR and SBFM/BFM/UBFM's bitmask-immediate fields, see the note below", color: COLOR.imm },
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
          {
            kind: "note",
            text: "SBFM/BFM/UBFM's immr/imms name a real alias, not a raw bitfield move, whenever one applies: SXTB/SXTH/SXTW and LSR/ASR (immr=0 or imms=regsize-1), LSL (a UBFM whose imms+1=immr exactly), BFI/SBFIZ/UBFIZ (imms<immr, general case), and BFXIL/SBFX/UBFX (imms>=immr, general case) — checked in that order, the same priority the real assembler gives them.",
          },
          {
            kind: "note",
            text: "CSINC/CSINV/CSNEG's Rn=Rm=11111 (with an invertible cond) is CSET/CSETM; CSINC/CSINV/CSNEG's Rn=Rm (any register, invertible cond) is CINC/CINV/CNEG — both read the *inverted* cond, since e.g. `cset rd, eq` really means `csinc rd, wzr, wzr, ne`. CSEL itself has no such alias.",
          },
          {
            kind: "note",
            text: "MADD/MSUB with Ra=11111 are MUL/MNEG; SMADDL/SMSUBL/UMADDL/UMSUBL with Ra=11111 are SMULL/SMNEGL/UMULL/UMNEGL. SMULH/UMULH have no Ra at all (the field is fixed 11111) — they are never shown with one.",
          },
          {
            kind: "note",
            text: "ldst_excl's o2/o1/o0/L table: o1=0, o2=0 is exclusive (o0/L pick STXR/LDXR/STLXR/LDAXR); o1=0, o2=1 is ordered non-exclusive (o0 must be 1; L picks STLR/LDAR — o0=0 here is the RCpc LDAPR/STLLR family, out of scope); o1=1, o2=0 is compare-and-swap (o0/L pick CAS/CASL/CASA/CASAL).",
          },
        ],
      },
      {
        title: "Registers",
        kind: "group",
        text: "31 general-purpose registers, addressed as x0-x30 (64 bit) or w0-w30 (32 bit, the low half) depending on sf (or, where a class has no sf of its own, whatever this toolbox's own note on that class says decides it — size for the load/store families, destWide for signed loads and pairs, and so on). Register 31 is context dependent: the zero register (xzr/wzr) almost everywhere, but the stack pointer (sp) for rn and rd of the add/sub families, and always for a load/store base register — never for rm, and never for a plain register operand like CBZ's rt or a logical instruction's operands.",
        sections: [
          {
            kind: "grid",
            columns: [
              { label: "Field", mono: true },
              { label: "Classes", mono: true },
              { label: "31 reads as", mono: true, color: COLOR.rd },
            ],
            rows: [
              ["rn, rd", "ADD/SUB (immediate, register, extended)", "sp"],
              ["rd", "AND/ORR/EOR (imm/reg), MOVZ/MOVN/MOVK, bitfield, extract, condition-select results", "xzr / wzr"],
              ["rn, rm", "AND/ORR/EOR (register), bitfield/extract sources", "xzr / wzr"],
              ["rn", "every load/store family — the base register, always 64 bit regardless of the access size", "sp"],
              ["rt, rt2, rs", "every load/store and atomic family", "xzr / wzr"],
              ["ra", "MADD/MSUB-shaped multiplies (11111 here is the MUL/MNEG/... alias, not sp/zr)", "n/a — Ra=11111 is its own alias rule"],
            ],
          },
          {
            kind: "note",
            text: "x30 doubles as the link register: BL writes the return address there, and RET (now in scope, under BR/BLR/RET below) reads it back by default.",
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
        text: "N=1 negates Rm first, turning AND/ORR/EOR into BIC/ORN/EON (and ANDS into BICS). `mov rd, rm` is ORR with Rn=xzr/wzr and no shift; `mvn rd, rm` is ORN the same way — neither has a dedicated opcode of its own.",
        sections: [instGrid("logical_reg", "opc, N")],
      },
      {
        title: "LDR / STR (immediate)",
        kind: "group",
        text: "The unsigned-offset form: imm12 always scales by the access size, and is never negative. Includes the signed loads (LDRSB/LDRSH/LDRSW) now — their destination width follows opc2, not size, since a byte or halfword can sign-extend into either a W or an X register.",
        sections: [instGrid("ldst_imm", "size · opc2")],
      },
      {
        title: "SBFM / BFM / UBFM (bitfield move)",
        kind: "group",
        text: "See the alias note under Word layouts for exactly when each of SXTB/SXTH/SXTW, LSL/LSR/ASR, BFI/BFXIL, SBFIZ/SBFX/UBFIZ/UBFX applies — every row below is really this one instruction.",
        sections: [instGrid("bitfield", "opc")],
      },
      {
        title: "EXTR (and ROR, immediate)",
        kind: "group",
        text: "",
        sections: [instGrid("extract", "")],
      },
      {
        title: "ADR / ADRP",
        kind: "group",
        text: "",
        sections: [instGrid("pcrel", "op")],
      },
      {
        title: "ADD / SUB (extended register)",
        kind: "group",
        text: "",
        sections: [instGrid("addsub_ext", "opc")],
      },
      {
        title: "CSEL / CSINC / CSINV / CSNEG",
        kind: "group",
        text: "See the alias note under Word layouts for CSET/CSETM/CINC/CINV/CNEG.",
        sections: [instGrid("condselect", "op, op2")],
      },
      {
        title: "CCMP / CCMN",
        kind: "group",
        text: "",
        sections: [instGrid("condcompare", "op")],
      },
      {
        title: "LSLV / LSRV / ASRV / RORV, SDIV / UDIV",
        kind: "group",
        text: "",
        sections: [instGrid("dp2src", "opcode")],
      },
      {
        title: "RBIT / REV16 / REV / REV32 / CLZ / CLS",
        kind: "group",
        text: "",
        sections: [instGrid("dp1src", "opcode")],
      },
      {
        title: "MADD / MSUB and the widening / high multiplies",
        kind: "group",
        text: "See the alias note under Word layouts for MUL/MNEG/SMULL/SMNEGL/UMULL/UMNEGL.",
        sections: [instGrid("dp3src", "op31, o0")],
      },
      {
        title: "TBZ / TBNZ",
        kind: "group",
        text: "",
        sections: [instGrid("tbz_tbnz", "op")],
      },
      {
        title: "BR / BLR / RET",
        kind: "group",
        text: "",
        sections: [instGrid("br_reg", "op")],
      },
      {
        title: "LDUR / STUR, LDR / STR (pre/post-indexed)",
        kind: "group",
        text: "",
        sections: [instGrid("ldst_unscaled", "size · opc2 · idx")],
      },
      {
        title: "LDR / STR (register offset)",
        kind: "group",
        text: "",
        sections: [instGrid("ldst_regoffset", "size · opc2")],
      },
      {
        title: "LDP / STP",
        kind: "group",
        text: "",
        sections: [instGrid("ldst_pair", "opc, idx, L")],
      },
      {
        title: "LDXR/STXR, LDAXR/STLXR, LDAR/STLR, CAS family",
        kind: "group",
        text: "See the o2/o1/o0/L table under Word layouts.",
        sections: [instGrid("ldst_excl", "o2, o1, o0, L")],
      },
      {
        title: "LDR (literal)",
        kind: "group",
        text: "",
        sections: [instGrid("ldst_literal", "opc")],
      },
      {
        title: "LDADD / LDCLR / LDEOR / LDSET / ... , SWP",
        kind: "group",
        text: "Every (op, A, R, size) combination the architecture defines, not a hand-picked subset.",
        sections: [instGrid("atomic_ldop", "opc, A, R")],
      },
      {
        title: "Hints and barriers",
        kind: "group",
        text: "",
        sections: [instGrid("sysmisc", "CRn, CRm, op2")],
      },
      {
        title: "SVC / BRK / HLT",
        kind: "group",
        text: "",
        sections: [instGrid("excgen", "opc, LL")],
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
