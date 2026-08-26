// Data-processing (immediate): ADD/SUB, AND/ORR/EOR, MOVZ/MOVN/MOVK (all
// three already in the original 9-class core, now with their S-setting and
// aliased forms filled in), plus three classes new to this expansion —
// bitfield move, extract, and PC-relative address generation. All five
// families share the same top-level marker shape: bits 28:23 = 100xxx,
// consecutive values 010/100/101/110/111 picking the family — see each
// MARKERS entry below.

export const CLASSES = {
  // ADD/SUB (immediate) — verified against `add x0,x0,#0`=0x91000000. S
  // (bit 29 of the opc field) now has named ADDS/SUBS entries; CMP/CMN are
  // SUBS/ADDS with Rd=WZR/XZR, named in encode.js/decode.js by that field
  // relationship rather than a separate opc.
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
  // (also `mov` alias's base), EOR=0xD2000000 bases. ANDS now named; TST is
  // ANDS with Rd=WZR/XZR, MOV is ORR with Rn=WZR/XZR — both by relationship,
  // not a separate opc.
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
  // SBFM/BFM/UBFM (bitfield move) — verified: sf=0,opc=UBFM(10),N=0,immr=0,
  // imms=7,Rn=1,Rd=0 packs to 0x53001C20, the real `ubfx w0,w1,#0,#8`.
  // SXTB/SXTH/SXTW, UXTB/UXTH, LSL/LSR/ASR (immediate), BFI/BFXIL/SBFIZ/
  // SBFX/UBFIZ/UBFX are all this same instruction under an alias name,
  // chosen in encode.js/decode.js from how immr/imms/Rn relate — none of
  // them need their own opc or layout, the way riscv_toolbox's NOP is ADDI
  // x0,x0,0 under the RISC-V card's own rules.
  bitfield: {
    name: "SBFM/BFM/UBFM (bitfield)",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 29, width: 2 }],
      ["fixed", { shift: 23, width: 6 }],
      ["n", { shift: 22, width: 1 }],
      ["immr", { shift: 16, width: 6 }],
      ["imms", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // EXTR — the low bits of Rd come from Rm, the high bits from Rn, meeting
  // at a rotation point lsb picks. ROR (immediate) is EXTR with Rm=Rn.
  extract: {
    name: "EXTR",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["op21", { shift: 29, width: 2 }],
      ["fixed", { shift: 23, width: 6 }],
      ["n", { shift: 22, width: 1 }],
      ["o0", { shift: 21, width: 1 }],
      ["rm", { shift: 16, width: 5 }],
      ["lsb", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // ADR/ADRP — verified against `adr x0,.`=0x10000000, `adrp x0,.`=0x90000000
  // (both very well known base encodings). The 21 bit immediate is split
  // immhi:immlo across the word the way B/BL's is not — an ARM oddity kept
  // here rather than smoothed over, the same way riscv_toolbox keeps U/J's
  // scrambled immediate bit order rather than hiding it.
  pcrel: {
    name: "ADR/ADRP",
    layout: [
      ["op", { shift: 31, width: 1 }],
      ["immlo", { shift: 29, width: 2 }],
      ["fixed", { shift: 24, width: 5 }],
      ["immhi", { shift: 5, width: 19 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
};

// Every marker is a list of independently-checked (shift, width, value)
// parts — plain fields, never a field that also carries real operand data —
// all of which must hold for a word to belong to the class. A single part is
// enough for most of these families; extract and pcrel need a second part
// because their single 6/5-bit "family" prefix alone is not unique — see
// each comment.
export const MARKERS = [
  // 010/100/101/110/111 at bits 28:23 — the five data-processing-immediate
  // families, in the order the architecture itself lays them out.
  ["addsub_imm", [{ shift: 23, width: 6, value: 0b100010 }]],
  ["logical_imm", [{ shift: 23, width: 6, value: 0b100100 }]],
  ["movewide", [{ shift: 23, width: 6, value: 0b100101 }]],
  ["bitfield", [{ shift: 23, width: 6, value: 0b100110 }]],
  // extract's family bits alone (100111) do not distinguish it from a few
  // reserved encodings the same 6 bits cover — op21 (bits 30:29, must be 00)
  // and o0 (bit 21, must be 0) are also genuinely fixed for EXTR itself.
  ["extract", [
    { shift: 23, width: 6, value: 0b100111 },
    { shift: 29, width: 2, value: 0b00 },
    { shift: 21, width: 1, value: 0 },
  ]],
  // pcrel's own fixed bits are only 5 wide (24:28 = 10000) — bit 23 is the
  // top of immhi, real data, not part of the marker.
  ["pcrel", [{ shift: 24, width: 5, value: 0b10000 }]],
];

export const INSTRUCTIONS = [
  { name: "add", class: "addsub_imm", opc: 0b00100010, desc: "Rd = Rn + imm" },
  { name: "sub", class: "addsub_imm", opc: 0b10100010, desc: "Rd = Rn - imm" },
  { name: "adds", class: "addsub_imm", opc: 0b01100010, desc: "Rd = Rn + imm, flags set" },
  { name: "subs", class: "addsub_imm", opc: 0b11100010, desc: "Rd = Rn - imm, flags set" },
  { name: "and", class: "logical_imm", opc: 0b00100100, desc: "Rd = Rn & imm" },
  { name: "orr", class: "logical_imm", opc: 0b01100100, desc: "Rd = Rn | imm" },
  { name: "eor", class: "logical_imm", opc: 0b10100100, desc: "Rd = Rn ^ imm" },
  { name: "ands", class: "logical_imm", opc: 0b11100100, desc: "Rd = Rn & imm, flags set" },
  { name: "movn", class: "movewide", opc: 0b00100101, desc: "Rd = ~(imm16 << shift)" },
  { name: "movz", class: "movewide", opc: 0b10100101, desc: "Rd = imm16 << shift" },
  { name: "movk", class: "movewide", opc: 0b11100101, desc: "Rd[shift+15:shift] = imm16" },
  { name: "sbfm", class: "bitfield", opc: 0b00, desc: "Rd = SignExtend(Rn<imms:immr>)", note: "shown under its alias (SXTB/SXTH/SXTW/ASR/SBFIZ/SBFX) whenever one applies" },
  { name: "bfm", class: "bitfield", opc: 0b01, desc: "Rd<imms:immr-derived range> = Rn<...>, rest of Rd unchanged", note: "shown as BFI/BFXIL whenever one applies" },
  { name: "ubfm", class: "bitfield", opc: 0b10, desc: "Rd = ZeroExtend(Rn<imms:immr>)", note: "shown under its alias (UXTB/UXTH/LSL/LSR/UBFIZ/UBFX) whenever one applies" },
  { name: "extr", class: "extract", op21: 0b00, desc: "Rd = (Rn:Rm)<lsb+31:lsb>", note: "shown as ROR when Rm and Rn are the same register" },
  { name: "adr", class: "pcrel", op: 0, desc: "Rd = PC + offset" },
  { name: "adrp", class: "pcrel", op: 1, desc: "Rd = (PC & ~0xFFF) + offset*4096" },
];

// bitfieldAlias picks which of SXTB/SXTH/SXTW, LSL/LSR/ASR, BFI/BFXIL,
// SBFIZ/SBFX/UBFIZ/UBFX (or, failing all of those, the plain SBFM/BFM/UBFM
// name) a bitfield instruction's own immr/imms/opc relationship names it —
// every one of these is a real, standard alias of the same instruction and
// encoding, chosen by relationship rather than a field of their own, the
// same way riscv_toolbox reads NOP out of ADDI x0,x0,0's own fields. Callers
// only reach for this once sf/opc/immr/imms are all known — see
// encode.js/decode.js.
export function bitfieldAlias(sf, opc, immr, imms) {
  const regsize = sf ? 64 : 32;
  const signed = opc === 0b00;
  const isBfm = opc === 0b01;
  if (!isBfm) {
    // SXT*/UXT* always read Rn as W — the whole point is sign/zero-
    // extending a narrower value, so the source is never shown at the
    // destination's own (possibly 64 bit) width.
    if (immr === 0 && imms === 7) return { name: signed ? "sxtb" : "uxtb", narrowSrc: true };
    if (immr === 0 && imms === 15) return { name: signed ? "sxth" : "uxth", narrowSrc: true };
    if (signed && sf && immr === 0 && imms === 31) return { name: "sxtw", narrowSrc: true };
    if (imms === regsize - 1) return { name: signed ? "asr" : "lsr", shift: immr };
  }
  if (imms < immr) {
    if (!isBfm && !signed && imms + 1 === immr) return { name: "lsl", shift: regsize - immr };
    return { name: isBfm ? "bfi" : signed ? "sbfiz" : "ubfiz", lsb: (regsize - immr) % regsize, width: imms + 1 };
  }
  return { name: isBfm ? "bfxil" : signed ? "sbfx" : "ubfx", lsb: immr, width: imms - immr + 1 };
}

export function find(cls, fields) {
  if (cls === "extract") {
    return fields.op21 === 0b00 ? INSTRUCTIONS.find((i) => i.class === cls) || null : null;
  }
  if (cls === "pcrel") {
    return INSTRUCTIONS.find((i) => i.class === cls && i.op === fields.op) || null;
  }
  return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc) || null;
}
