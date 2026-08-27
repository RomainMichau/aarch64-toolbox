// Branches: B, BL, B.cond, CBZ/CBNZ (the original 9-class core, unchanged),
// plus TBZ/TBNZ (test one bit, branch if it matches) and BR/BLR/RET (branch
// to an address held in a register, rather than a PC-relative offset).

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
  // TBZ, TBNZ — verified: the packed byte for `tbnz w0,#0,.` is 0x37, the
  // well known TBNZ prefix (0x36/0x37/0xB6/0xB7 for TBZ/TBNZ, w/x forms).
  // b5:b40 is the bit position to test, split the same scrambled way ADR's
  // immhi:immlo is — b5 alone also picks W (0) or X (1) for Rt, since a bit
  // position of 32 or above only exists in a 64 bit register.
  tbz_tbnz: {
    name: "TBZ / TBNZ",
    layout: [
      ["b5", { shift: 31, width: 1 }],
      ["fixed", { shift: 25, width: 6 }],
      ["op", { shift: 24, width: 1 }],
      ["b40", { shift: 19, width: 5 }],
      ["imm14", { shift: 5, width: 14 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // BR, BLR, RET — verified against `br x0`=0xD61F0000, `blr x0`=0xD63F0000
  // and `ret`(x30 implied)=0xD65F03C0, each checked field by field.
  //
  // The opcode here is one 4 bit field at 24:21, not three. Splitting it
  // into z(24)/op(23:22)/a(21) and calling bit 21 a pointer-authentication
  // bit cost BLR twice over: bit 21 is the opcode's low bit and it is
  // exactly what tells BLR from BR, so the real 0xD63F0000 did not decode,
  // and the value picked for BLR by elimination over the wrong field
  // (0b10, i.e. opc=0100) packed ERET's slot instead.
  br_reg: {
    name: "BR / BLR / RET",
    layout: [
      ["fixed1", { shift: 25, width: 7 }],
      ["op", { shift: 21, width: 4 }],
      ["op2", { shift: 16, width: 5 }],
      ["op3", { shift: 10, width: 6 }],
      ["rn", { shift: 5, width: 5 }],
      ["op4", { shift: 0, width: 5 }],
    ],
  },
};

export const MARKERS = [
  ["b_bl", [{ shift: 26, width: 5, value: 0b00101 }]],
  ["b_cond", [{ shift: 24, width: 8, value: 0b01010100 }]],
  ["cbz_cbnz", [{ shift: 25, width: 6, value: 0b011010 }]],
  ["tbz_tbnz", [{ shift: 25, width: 6, value: 0b011011 }]],
  // 31:25 is the only bit run that is constant for the whole class — op is
  // real per-instruction data, and op2/op3/op4 are constant per instruction
  // rather than per class, so find() checks those instead (the same split
  // classify() vs find() draws for addsub_reg's shiftop and logical_reg's
  // N). Pinning op's top bit to 0 as well is what keeps the class to the
  // three plain forms: opc=01xx is ERET/DRPS and opc=1xxx the pointer
  // authentication variants, all out of scope, and now told so by find()
  // rather than silently classified as something else.
  ["br_reg", [
    { shift: 25, width: 7, value: 0b1101011 },
    { shift: 24, width: 1, value: 0 },
  ]],
];

export const INSTRUCTIONS = [
  { name: "b", class: "b_bl", opc: 0b000101, desc: "PC = PC + offset" },
  { name: "bl", class: "b_bl", opc: 0b100101, desc: "X30 = PC + 4; PC = PC + offset" },
  { name: "b.cond", class: "b_cond", opc: 0b01010100, desc: "if (cond) PC = PC + offset" },
  { name: "cbz", class: "cbz_cbnz", opc: 0b0110100, desc: "if (Rt == 0) PC = PC + offset" },
  { name: "cbnz", class: "cbz_cbnz", opc: 0b0110101, desc: "if (Rt != 0) PC = PC + offset" },
  { name: "tbz", class: "tbz_tbnz", op: 0, desc: "if (Rt<bit> == 0) PC = PC + offset" },
  { name: "tbnz", class: "tbz_tbnz", op: 1, desc: "if (Rt<bit> != 0) PC = PC + offset" },
  { name: "br", class: "br_reg", op: 0b0000, desc: "PC = Rn" },
  { name: "blr", class: "br_reg", op: 0b0001, desc: "X30 = PC + 4; PC = Rn" },
  { name: "ret", class: "br_reg", op: 0b0010, desc: "PC = Rn" },
];

export function find(cls, fields) {
  if (cls === "tbz_tbnz") {
    return INSTRUCTIONS.find((i) => i.class === cls && i.op === fields.op) || null;
  }
  if (cls === "br_reg") {
    if (fields.op2 !== 0b11111 || fields.op3 !== 0 || fields.op4 !== 0) return null; // reserved combination
    return INSTRUCTIONS.find((i) => i.class === cls && i.op === fields.op) || null;
  }
  return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc) || null;
}
