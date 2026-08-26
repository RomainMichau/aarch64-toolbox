// Loads and stores: the unsigned-immediate-offset family (the original
// 9-class core, now with the signed loads LDRSB/LDRSH/LDRSW filled in),
// plus five classes new to this expansion — unscaled/pre/post-indexed
// immediate offset, register offset, pair, exclusive/ordered/compare-and-
// swap, and PC-relative literal loads.
//
// Every one of these shares the same "which register width" question, and
// every class answers it the same way: the base register (Rn) is always 64
// bit (X or SP), no matter the transfer size, and only the data register(s)
// follow the class's own width field — ldst_imm/unscaled/regoffset key that
// off `destWide` (set per instruction row, since LDRSB/H/W's destination
// width does not track `size` the way a plain load's does); ldst_pair and
// ldst_excl key it off their own size/opc field directly.

// LDST_OPS is the (size, opc) grid every unsigned-offset-shaped class
// shares — ldst_imm (immediate), ldst_unscaled (LDUR/STUR + pre/post index)
// and ldst_regoffset (register offset) all read the same size:opc2 table,
// just through a different addressing mode. Writing it once keeps the three
// from drifting apart the way the original ldst_imm table alone could not.
export const LDST_OPS = [
  { op: "str", size: 0b00, opc2: 0b00, destWide: false, desc: "M8[addr] = Rt[7:0]" },
  { op: "ldr", size: 0b00, opc2: 0b01, destWide: false, desc: "Rt = ZeroExtend(M8[addr])" },
  { op: "strh", size: 0b01, opc2: 0b00, destWide: false, desc: "M16[addr] = Rt[15:0]" },
  { op: "ldrh", size: 0b01, opc2: 0b01, destWide: false, desc: "Rt = ZeroExtend(M16[addr])" },
  { op: "str", size: 0b10, opc2: 0b00, destWide: false, desc: "M32[addr] = Wt" },
  { op: "ldr", size: 0b10, opc2: 0b01, destWide: false, desc: "Wt = M32[addr]" },
  { op: "str", size: 0b11, opc2: 0b00, destWide: true, desc: "M64[addr] = Xt" },
  { op: "ldr", size: 0b11, opc2: 0b01, destWide: true, desc: "Xt = M64[addr]" },
  { op: "ldrsb", size: 0b00, opc2: 0b10, destWide: true, desc: "Xt = SignExtend(M8[addr])" },
  { op: "ldrsb", size: 0b00, opc2: 0b11, destWide: false, desc: "Wt = SignExtend(M8[addr])" },
  { op: "ldrsh", size: 0b01, opc2: 0b10, destWide: true, desc: "Xt = SignExtend(M16[addr])" },
  { op: "ldrsh", size: 0b01, opc2: 0b11, destWide: false, desc: "Wt = SignExtend(M16[addr])" },
  { op: "ldrsw", size: 0b10, opc2: 0b10, destWide: true, desc: "Xt = SignExtend(M32[addr])" },
];
// Note ldst_imm's own strb/ldrb naming above is folded into str/ldr at
// size 00 the same way byte-size str/ldr already were, but a byte access
// still needs the "b" in its mnemonic where a word/doubleword access does
// not — mnemonicFor() below adds it back for size 00, and "h" for size 01.
export function mnemonicFor(op, size) {
  if (op === "str" || op === "ldr") return op + (size === 0b00 ? "b" : size === 0b01 ? "h" : "");
  return op; // ldrsb/ldrsh/ldrsw already spell their own size out
}

export const CLASSES = {
  // LDR/STR (unsigned immediate offset) — verified against `str x0,[x1]` =
  // 0xF9000000, `ldr x0,[x1]` = 0xF9400020, `ldr w0,[x1]` base = 0xB9400000,
  // `strb w0,[x1]` base = 0x39000000, `ldrh w0,[x1]` base = 0x79400000.
  ldst_imm: {
    name: "LDR/STR (immediate, unsigned offset)",
    layout: [
      ["size", { shift: 30, width: 2 }],
      ["opc", { shift: 22, width: 8 }],
      ["imm12", { shift: 10, width: 12 }],
      ["rn", { shift: 5, width: 5 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // LDUR/STUR (unscaled) and pre/post-indexed LDR/STR — one class, since
  // all three share every field including the fixed marker bits, and differ
  // only in `idx`'s value: 00 (no writeback, the LDUR/STUR spelling),
  // 01 (post-indexed: access at [Rn], then Rn += imm9) and
  // 11 (pre-indexed: Rn += imm9 first, then access at [Rn]).
  // 10 (LDTR/STTR, unprivileged access) shares the marker but is out of
  // scope, same as the other families' reserved siblings.
  ldst_unscaled: {
    name: "LDUR/STUR, LDR/STR (pre/post-indexed)",
    layout: [
      ["size", { shift: 30, width: 2 }],
      ["vfixed", { shift: 24, width: 6 }],
      ["opc", { shift: 22, width: 2 }],
      ["zero21", { shift: 21, width: 1 }],
      ["imm9", { shift: 12, width: 9 }],
      ["idx", { shift: 10, width: 2 }],
      ["rn", { shift: 5, width: 5 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // LDR/STR (register offset) — address is Rn + extend(Rm) << (0 or the
  // access size's own log2, S picks which). option's extend types: 010
  // UXTW, 011 LSL (Rm read as a plain 64 bit value), 110 SXTW, 111 SXTX;
  // 000/001/100/101 are reserved (32 bit Rm without an extend is undefined).
  ldst_regoffset: {
    name: "LDR/STR (register offset)",
    layout: [
      ["size", { shift: 30, width: 2 }],
      ["vfixed", { shift: 24, width: 6 }],
      ["opc", { shift: 22, width: 2 }],
      ["one21", { shift: 21, width: 1 }],
      ["rm", { shift: 16, width: 5 }],
      ["option", { shift: 13, width: 3 }],
      ["s", { shift: 12, width: 1 }],
      ["fixed10", { shift: 10, width: 2 }],
      ["rn", { shift: 5, width: 5 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // LDP/STP — verified field by field against two well known prologue/
  // epilogue words: `stp x0,x1,[sp,#-16]!` = 0xA9BF07E0 (pre-indexed) and
  // `ldp x29,x30,[sp],#16` = 0xA8C17BFD (post-indexed). idx picks the
  // addressing mode the same way ldst_unscaled's does: 001 post, 010 plain
  // signed offset (no writeback), 011 pre; 000 is STNP/LDNP (a
  // non-temporal hint pair, out of scope).
  ldst_pair: {
    name: "LDP/STP",
    layout: [
      ["opc", { shift: 30, width: 2 }],
      ["fixed", { shift: 27, width: 3 }],
      ["v", { shift: 26, width: 1 }],
      ["idx", { shift: 23, width: 3 }],
      ["l", { shift: 22, width: 1 }],
      ["imm7", { shift: 15, width: 7 }],
      ["rt2", { shift: 10, width: 5 }],
      ["rn", { shift: 5, width: 5 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // LDXR/STXR, LDAXR/STLXR, LDAR/STLR, and CAS/CASA/CASL/CASAL — one real
  // encoding group (Load/store exclusive), verified against `ldar x0,[x1]`
  // = 0xC8DFFC20 and `cas w0,w1,[x2]` = 0x88A07C41, both field by field.
  // o1 tells exclusive/ordered (0) from compare-and-swap (1) apart; within
  // each, o2/o0/L pick which of the six or four named instructions it is —
  // see find() for the exact table. Byte/halfword-sized exclusive and CAS
  // (LDXRB, CASH, ...) classify correctly here but are not named, the same
  // trim the original core applies to ADDS/SUBS/ANDS.
  ldst_excl: {
    name: "LDXR/STXR/LDAR/STLR/CAS family",
    layout: [
      ["size", { shift: 30, width: 2 }],
      ["fixed", { shift: 24, width: 6 }],
      ["o2", { shift: 23, width: 1 }],
      ["l", { shift: 22, width: 1 }],
      ["o1", { shift: 21, width: 1 }],
      ["rs", { shift: 16, width: 5 }],
      ["o0", { shift: 15, width: 1 }],
      ["rt2", { shift: 10, width: 5 }],
      ["rn", { shift: 5, width: 5 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // LDR (literal) — verified against `ldr x0, <label>` = 0x58000000, the
  // well known base for a PC-relative 64 bit load. imm19 is a word count,
  // the same convention every other PC-relative field in this toolbox uses.
  ldst_literal: {
    name: "LDR (literal)",
    layout: [
      ["opc", { shift: 30, width: 2 }],
      ["fixed", { shift: 24, width: 6 }],
      ["imm19", { shift: 5, width: 19 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
};

export const MARKERS = [
  ["ldst_imm", [{ shift: 24, width: 6, value: 0b111001 }]],
  ["ldst_unscaled", [{ shift: 24, width: 6, value: 0b111000 }, { shift: 21, width: 1, value: 0 }]],
  ["ldst_regoffset", [{ shift: 24, width: 6, value: 0b111000 }, { shift: 21, width: 1, value: 1 }, { shift: 10, width: 2, value: 0b10 }]],
  ["ldst_pair", [{ shift: 27, width: 3, value: 0b101 }, { shift: 26, width: 1, value: 0 }]],
  ["ldst_excl", [{ shift: 24, width: 6, value: 0b001000 }]],
  ["ldst_literal", [{ shift: 24, width: 6, value: 0b011000 }]],
];

export const INSTRUCTIONS = [
  ...LDST_OPS.map(({ op, size, opc2, destWide, desc }) => ({
    name: mnemonicFor(op, size), class: "ldst_imm", size, opc2, destWide,
    desc: desc.replace("addr", "Rn + imm"),
  })),
  ...LDST_OPS.flatMap(({ op, size, opc2, destWide, desc }) =>
    [0b00, 0b01, 0b11].map((idx) => ({
      name: idx === 0b00 ? op.slice(0, 2) + "u" + op.slice(2) : mnemonicFor(op, size),
      class: "ldst_unscaled", size, opc2, idx, destWide,
      desc: desc.replace("addr", idx === 0b00 ? "Rn + imm" : "Rn, with writeback"),
    })),
  ),
  ...LDST_OPS.map(({ op, size, opc2, destWide, desc }) => ({
    name: mnemonicFor(op, size), class: "ldst_regoffset", size, opc2, destWide,
    desc: desc.replace("addr", "Rn + extend(Rm)"),
  })),
  ...[0b00, 0b10].flatMap((opc) => [0b001, 0b010, 0b011].flatMap((idx) => [0, 1].map((l) => ({
    name: l ? "ldp" : "stp", class: "ldst_pair", opc, idx, l, destWide: opc === 0b10,
    desc: l ? "Rt, Rt2 = M[addr], M[addr+size]" : "M[addr], M[addr+size] = Rt, Rt2",
  })))),
  { name: "stxr", class: "ldst_excl", o2: 0, o1: 0, o0: 0, l: 0, desc: "M[Rn] = Rt; Rs = 0 if the store succeeded, 1 if the exclusive monitor had already been cleared" },
  { name: "ldxr", class: "ldst_excl", o2: 0, o1: 0, o0: 0, l: 1, desc: "Rt = M[Rn]; opens the exclusive monitor for Rn" },
  { name: "stlxr", class: "ldst_excl", o2: 0, o1: 0, o0: 1, l: 0, desc: "M[Rn] = Rt with release ordering; Rs = 0/1 as stxr" },
  { name: "ldaxr", class: "ldst_excl", o2: 0, o1: 0, o0: 1, l: 1, desc: "Rt = M[Rn] with acquire ordering; opens the exclusive monitor" },
  { name: "stlr", class: "ldst_excl", o2: 1, o1: 0, o0: 1, l: 0, desc: "M[Rn] = Rt with release ordering, non-exclusive" },
  { name: "ldar", class: "ldst_excl", o2: 1, o1: 0, o0: 1, l: 1, desc: "Rt = M[Rn] with acquire ordering, non-exclusive" },
  { name: "cas", class: "ldst_excl", o2: 0, o1: 1, o0: 0, l: 0, desc: "if (M[Rn] == Rs) M[Rn] = Rt; Rs = old M[Rn] either way" },
  { name: "casl", class: "ldst_excl", o2: 0, o1: 1, o0: 1, l: 0, desc: "cas with release ordering on the store" },
  { name: "casa", class: "ldst_excl", o2: 0, o1: 1, o0: 0, l: 1, desc: "cas with acquire ordering on the load" },
  { name: "casal", class: "ldst_excl", o2: 0, o1: 1, o0: 1, l: 1, desc: "cas with acquire and release ordering" },
  { name: "ldr", class: "ldst_literal", opc: 0b00, destWide: false, desc: "Wt = M32[PC + offset]" },
  { name: "ldr", class: "ldst_literal", opc: 0b01, destWide: true, desc: "Xt = M64[PC + offset]" },
  { name: "ldrsw", class: "ldst_literal", opc: 0b10, destWide: true, desc: "Xt = SignExtend(M32[PC + offset])" },
];

export function find(cls, fields) {
  if (cls === "ldst_imm") {
    return INSTRUCTIONS.find((i) => i.class === cls && i.size === fields.size && i.opc2 === (fields.opc & 0b11)) || null;
  }
  if (cls === "ldst_regoffset") {
    if (![0b010, 0b011, 0b110, 0b111].includes(fields.option)) return null; // extend type must be UXTW/LSL/SXTW/SXTX
    return INSTRUCTIONS.find((i) => i.class === cls && i.size === fields.size && i.opc2 === (fields.opc & 0b11)) || null;
  }
  if (cls === "ldst_unscaled") {
    if (fields.idx === 0b10) return null; // LDTR/STTR, unprivileged, out of scope
    return INSTRUCTIONS.find((i) => i.class === cls && i.size === fields.size && i.opc2 === (fields.opc & 0b11) && i.idx === fields.idx) || null;
  }
  if (cls === "ldst_pair") {
    if (fields.opc === 0b01 || fields.idx === 0b000) return null; // opc 01 is a SIMD/FP pair; idx 000 is STNP/LDNP
    return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc && i.idx === fields.idx && i.l === fields.l) || null;
  }
  if (cls === "ldst_excl") {
    if (fields.size !== 0b10 && fields.size !== 0b11) return null; // byte/halfword forms out of scope
    return INSTRUCTIONS.find((i) => i.class === cls && i.o2 === fields.o2 && i.o1 === fields.o1 && i.o0 === fields.o0 && i.l === fields.l) || null;
  }
  if (cls === "ldst_literal") {
    return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc) || null;
  }
  return null;
}
