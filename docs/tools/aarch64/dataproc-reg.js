// Data-processing (register): ADD/SUB and AND/ORR/EOR shifted-register (both
// already in the original 9-class core, now with S-setting, BIC/ORN/EON and
// their aliases filled in), plus six classes new to this expansion —
// extended-register add/sub, conditional select, conditional compare, and
// the three "N source" register-only families (2-source shifts/divide,
// 1-source bit/byte ops, 3-source multiply-accumulate).

export const CLASSES = {
  // ADD/SUB (shifted register) — verified against `add x0,x1,x2`=0x8B020020.
  // Bit 21 (the low bit of `shiftop`) is 0 here and 1 for addsub_ext below —
  // the one truly-fixed bit telling the two apart, same shape as opc's S bit.
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
  // ADD/SUB (extended register) — shares addsub_reg's op/S/01011 marker, but
  // bit 21 is 1 here (see above) and the low bits hold an extend-type +
  // shift-by-0-to-4 instead of a shift-type + shift-by-0-to-63. Used for
  // pointer arithmetic against a 32 bit index (`add x0, x1, w2, uxtw #2`).
  addsub_ext: {
    name: "ADD/SUB (extended register)",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["opc", { shift: 24, width: 7 }],
      ["opt", { shift: 22, width: 2 }],
      ["one21", { shift: 21, width: 1 }],
      ["rm", { shift: 16, width: 5 }],
      ["option", { shift: 13, width: 3 }],
      ["imm3", { shift: 10, width: 3 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // AND/ORR/EOR (shifted register) — verified against `mov x0,x1`(orr alias)
  // = 0xAA0103E0, AND base 0x8A000000, EOR base 0xCA000000. ANDS and the
  // N=1 siblings BIC/ORN/EON/BICS are now named (found by opc *and* N, see
  // find() below); MOV/MVN/TST are opc+N combinations read by register
  // relationship, the same as CMP/CMN elsewhere in this toolbox.
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
  // CSEL/CSINC/CSINV/CSNEG — verified against `csel x0,x1,x2,eq`=0x9A820020.
  // CSET/CSETM/CINC/CINV/CNEG are all named by how rm relates to rn and to
  // 11111 — see encode.js/decode.js.
  condselect: {
    name: "CSEL/CSINC/CSINV/CSNEG",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["op", { shift: 30, width: 1 }],
      ["s", { shift: 29, width: 1 }],
      ["fixed", { shift: 21, width: 8 }],
      ["rm", { shift: 16, width: 5 }],
      ["cond", { shift: 12, width: 4 }],
      ["op2", { shift: 10, width: 2 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // CCMP/CCMN — the same test CSEL's cond bits gate, but for the flags
  // themselves: run the comparison only if cond holds, otherwise force the
  // flags to the 4 bit constant in nzcv. `flag` (bit 11) is the one real,
  // fixed-per-operand-kind bit: 0 reads rm_imm as a register, 1 as a 5 bit
  // unsigned immediate.
  condcompare: {
    name: "CCMP/CCMN",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["op", { shift: 30, width: 1 }],
      ["s", { shift: 29, width: 1 }],
      ["fixed", { shift: 21, width: 8 }],
      ["rm_imm", { shift: 16, width: 5 }],
      ["cond", { shift: 12, width: 4 }],
      ["flag", { shift: 11, width: 1 }],
      ["o3", { shift: 10, width: 1 }],
      ["rn", { shift: 5, width: 5 }],
      ["o4", { shift: 4, width: 1 }],
      ["nzcv", { shift: 0, width: 4 }],
    ],
  },
  // Data-processing (2 source): the register-shift and integer-divide
  // instructions — LSL/LSR/ASR/ROR's *register* forms (the immediate forms
  // are bitfield aliases, a different class entirely) plus SDIV/UDIV.
  dp2src: {
    name: "LSLV/LSRV/ASRV/RORV, SDIV/UDIV",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["zero30", { shift: 30, width: 1 }],
      ["s", { shift: 29, width: 1 }],
      ["fixed", { shift: 21, width: 8 }],
      ["rm", { shift: 16, width: 5 }],
      ["opcode", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // Data-processing (1 source): RBIT, REV16, REV/REV32, CLZ, CLS — shares
  // dp2src's 8 bit fixed marker, distinguished by bit 30 (1 here, 0 there).
  dp1src: {
    name: "RBIT/REV16/REV/REV32/CLZ/CLS",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["one30", { shift: 30, width: 1 }],
      ["s", { shift: 29, width: 1 }],
      ["fixed", { shift: 21, width: 8 }],
      ["opcode2", { shift: 16, width: 5 }],
      ["opcode", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
  // Data-processing (3 source): MADD/MSUB and the widening multiplies —
  // verified structurally against `mul w0,w1,w2` (MADD w0,w1,w2,wzr), whose
  // packed word begins 0x1B, the well known MUL prefix byte.
  dp3src: {
    name: "MADD/MSUB, S/UMADDL/S/UMSUBL, S/UMULH",
    layout: [
      ["sf", { shift: 31, width: 1 }],
      ["op54", { shift: 29, width: 2 }],
      ["fixed", { shift: 24, width: 5 }],
      ["op31", { shift: 21, width: 3 }],
      ["rm", { shift: 16, width: 5 }],
      ["o0", { shift: 15, width: 1 }],
      ["ra", { shift: 10, width: 5 }],
      ["rn", { shift: 5, width: 5 }],
      ["rd", { shift: 0, width: 5 }],
    ],
  },
};

export const MARKERS = [
  ["addsub_reg", [{ shift: 24, width: 5, value: 0b01011 }, { shift: 21, width: 1, value: 0 }]],
  ["addsub_ext", [{ shift: 24, width: 5, value: 0b01011 }, { shift: 21, width: 1, value: 1 }]],
  ["logical_reg", [{ shift: 24, width: 5, value: 0b01010 }]],
  ["condselect", [{ shift: 21, width: 8, value: 0b11010100 }, { shift: 29, width: 1, value: 0 }]],
  ["condcompare", [
    { shift: 21, width: 8, value: 0b11010010 }, { shift: 29, width: 1, value: 1 },
    { shift: 10, width: 1, value: 0 }, { shift: 4, width: 1, value: 0 },
  ]],
  ["dp2src", [{ shift: 21, width: 8, value: 0b11010110 }, { shift: 30, width: 1, value: 0 }, { shift: 29, width: 1, value: 0 }]],
  ["dp1src", [{ shift: 21, width: 8, value: 0b11010110 }, { shift: 30, width: 1, value: 1 }, { shift: 29, width: 1, value: 0 }]],
  ["dp3src", [{ shift: 24, width: 5, value: 0b11011 }, { shift: 29, width: 2, value: 0b00 }]],
];

// logical_reg's four opc values, each with an N=0 (plain) and N=1 (Rm
// complemented first) sibling — the same op54 pairing addsub_imm/reg use
// for op/S, just one bit further out.
const LOGICAL = [
  { opc: 0b0001010, n0: "and", n1: "bic" },
  { opc: 0b0101010, n0: "orr", n1: "orn" },
  { opc: 0b1001010, n0: "eor", n1: "eon" },
  { opc: 0b1101010, n0: "ands", n1: "bics" },
];

export const INSTRUCTIONS = [
  { name: "add", class: "addsub_reg", opc: 0b0001011, desc: "Rd = Rn + shift(Rm)" },
  { name: "sub", class: "addsub_reg", opc: 0b1001011, desc: "Rd = Rn - shift(Rm)" },
  { name: "adds", class: "addsub_reg", opc: 0b0101011, desc: "Rd = Rn + shift(Rm), flags set" },
  { name: "subs", class: "addsub_reg", opc: 0b1101011, desc: "Rd = Rn - shift(Rm), flags set" },
  { name: "add", class: "addsub_ext", opc: 0b0001011, desc: "Rd = Rn + extend(Rm)" },
  { name: "sub", class: "addsub_ext", opc: 0b1001011, desc: "Rd = Rn - extend(Rm)" },
  { name: "adds", class: "addsub_ext", opc: 0b0101011, desc: "Rd = Rn + extend(Rm), flags set" },
  { name: "subs", class: "addsub_ext", opc: 0b1101011, desc: "Rd = Rn - extend(Rm), flags set" },
  ...LOGICAL.flatMap(({ opc, n0, n1 }) => [
    { name: n0, class: "logical_reg", opc, n: 0, desc: `Rd = Rn ${{ and: "&", bic: "&", orr: "|", orn: "|", eor: "^", eon: "^", ands: "&", bics: "&" }[n0]} shift(Rm)${n0.endsWith("s") ? ", flags set" : ""}` },
    { name: n1, class: "logical_reg", opc, n: 1, desc: `Rd = Rn ${{ bic: "&", orn: "|", eon: "^", bics: "&" }[n1]} ~shift(Rm)${n1.endsWith("s") ? ", flags set" : ""}` },
  ]),
  { name: "csel", class: "condselect", op: 0, op2: 0b00, desc: "Rd = cond ? Rn : Rm" },
  { name: "csinc", class: "condselect", op: 0, op2: 0b01, desc: "Rd = cond ? Rn : Rm + 1" },
  { name: "csinv", class: "condselect", op: 1, op2: 0b00, desc: "Rd = cond ? Rn : ~Rm" },
  { name: "csneg", class: "condselect", op: 1, op2: 0b01, desc: "Rd = cond ? Rn : -Rm" },
  { name: "ccmn", class: "condcompare", op: 0, desc: "flags = cond ? flagsOf(Rn + op2) : nzcv" },
  { name: "ccmp", class: "condcompare", op: 1, desc: "flags = cond ? flagsOf(Rn - op2) : nzcv" },
  { name: "udiv", class: "dp2src", opcode: 0b000010, desc: "Rd = Rn / Rm, unsigned" },
  { name: "sdiv", class: "dp2src", opcode: 0b000011, desc: "Rd = Rn / Rm, signed" },
  { name: "lslv", class: "dp2src", opcode: 0b001000, desc: "Rd = Rn << (Rm mod regsize)" },
  { name: "lsrv", class: "dp2src", opcode: 0b001001, desc: "Rd = Rn >> (Rm mod regsize), unsigned" },
  { name: "asrv", class: "dp2src", opcode: 0b001010, desc: "Rd = Rn >> (Rm mod regsize), signed" },
  { name: "rorv", class: "dp2src", opcode: 0b001011, desc: "Rd = Rn rotated right by (Rm mod regsize)" },
  { name: "rbit", class: "dp1src", opcode: 0b000000, desc: "Rd = Rn with every bit reversed" },
  { name: "rev16", class: "dp1src", opcode: 0b000001, desc: "Rd = Rn with every 16 bit halfword's bytes reversed" },
  { name: "rev", class: "dp1src", opcode: 0b000010, sfOnly: 0, desc: "Rd = Rn with all 4 bytes reversed" },
  { name: "rev32", class: "dp1src", opcode: 0b000010, sfOnly: 1, desc: "Rd = Rn with each 32 bit word's bytes reversed" },
  { name: "rev", class: "dp1src", opcode: 0b000011, sfOnly: 1, desc: "Rd = Rn with all 8 bytes reversed" },
  { name: "clz", class: "dp1src", opcode: 0b000100, desc: "Rd = count of leading zero bits in Rn" },
  { name: "cls", class: "dp1src", opcode: 0b000101, desc: "Rd = count of leading bits matching Rn's sign, excluding the sign bit itself" },
  { name: "madd", class: "dp3src", op31: 0b000, o0: 0, desc: "Rd = Ra + Rn * Rm" },
  { name: "msub", class: "dp3src", op31: 0b000, o0: 1, desc: "Rd = Ra - Rn * Rm" },
  { name: "smaddl", class: "dp3src", op31: 0b001, o0: 0, sfOnly: 1, desc: "Xd = Ra + SignExtend(Wn) * SignExtend(Wm)" },
  { name: "smsubl", class: "dp3src", op31: 0b001, o0: 1, sfOnly: 1, desc: "Xd = Ra - SignExtend(Wn) * SignExtend(Wm)" },
  { name: "smulh", class: "dp3src", op31: 0b010, o0: 0, sfOnly: 1, desc: "Xd = high 64 bits of Xn * Xm, signed" },
  { name: "umaddl", class: "dp3src", op31: 0b101, o0: 0, sfOnly: 1, desc: "Xd = Ra + ZeroExtend(Wn) * ZeroExtend(Wm)" },
  { name: "umsubl", class: "dp3src", op31: 0b101, o0: 1, sfOnly: 1, desc: "Xd = Ra - ZeroExtend(Wn) * ZeroExtend(Wm)" },
  { name: "umulh", class: "dp3src", op31: 0b110, o0: 0, sfOnly: 1, desc: "Xd = high 64 bits of Xn * Xm, unsigned" },
];

export function find(cls, fields) {
  // The encoder calls find() directly with whatever class the box picked,
  // never through classify() — so even though the marker already keeps a
  // *decoded* word from ever reaching the wrong one of these two, a typed
  // shiftop/one21 value that contradicts the class still has to be caught
  // here, the same way it always was before addsub_ext existed.
  if (cls === "addsub_reg" && (fields.shiftop & 0b001) !== 0) return null; // bit 21 set means this is really addsub_ext
  if (cls === "addsub_ext" && fields.one21 !== 1) return null; // bit 21 clear means this is really addsub_reg
  if (cls === "addsub_ext") {
    if (fields.opt !== 0b00) return null; // opt values other than 00 are reserved
    return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc) || null;
  }
  if (cls === "logical_reg") {
    return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc && i.n === fields.n) || null;
  }
  if (cls === "condcompare") {
    return INSTRUCTIONS.find((i) => i.class === cls && i.op === fields.op) || null;
  }
  if (cls === "dp2src") {
    return INSTRUCTIONS.find((i) => i.class === cls && i.opcode === fields.opcode) || null;
  }
  if (cls === "condselect") {
    if (fields.op2 & 0b10) return null; // op2 10/11 reserved
    return INSTRUCTIONS.find((i) => i.class === cls && i.op === fields.op && i.op2 === fields.op2) || null;
  }
  if (cls === "dp1src") {
    if (fields.opcode2 !== 0) return null;
    const sf = fields.sf === 1;
    return INSTRUCTIONS.find((i) => i.class === cls && i.opcode === fields.opcode && (i.sfOnly === undefined || i.sfOnly === (sf ? 1 : 0))) || null;
  }
  if (cls === "dp3src") {
    const sf = fields.sf === 1;
    const inst = INSTRUCTIONS.find((i) => i.class === cls && i.op31 === fields.op31 && i.o0 === fields.o0) || null;
    if (!inst) return null;
    if (inst.sfOnly !== undefined && !sf) return null; // the widening/high multiplies are 64 bit only
    return inst;
  }
  return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc) || null;
}
