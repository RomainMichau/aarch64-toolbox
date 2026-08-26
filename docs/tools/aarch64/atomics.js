// Atomic memory operations (LSE, ARMv8.1+): LDADD/LDCLR/LDEOR/LDSET and
// their signed/unsigned min/max siblings, plus SWP — read-modify-write a
// memory location in one instruction, returning the value it held before.
// (CAS/CASA/CASL/CASAL live in loadstore.js's ldst_excl instead — they
// share that class's real encoding, not this one's.)
//
// This shares loadstore.js's ldst_unscaled/ldst_regoffset outer marker
// (size,111,V=0,00 at bits 29:24) — bit 21 = 1 tells it apart from
// ldst_unscaled (0) the same way ldst_regoffset's does, and bits 11:10 = 00
// tell it apart from ldst_regoffset (10) in turn.
//
// Every (op, A, R, size) combination the architecture defines is generated
// below, not a hand-picked subset — cheap to do once the table exists, and
// more complete than trimming to "representative" rows would be.

const OPS = [
  { op: "ldadd", opc: 0b0000, desc: "M[Rn] + Rs" },
  { op: "ldclr", opc: 0b0001, desc: "M[Rn] & ~Rs" },
  { op: "ldeor", opc: 0b0010, desc: "M[Rn] ^ Rs" },
  { op: "ldset", opc: 0b0011, desc: "M[Rn] | Rs" },
  { op: "ldsmax", opc: 0b0100, desc: "signed max(M[Rn], Rs)" },
  { op: "ldsmin", opc: 0b0101, desc: "signed min(M[Rn], Rs)" },
  { op: "ldumax", opc: 0b0110, desc: "unsigned max(M[Rn], Rs)" },
  { op: "ldumin", opc: 0b0111, desc: "unsigned min(M[Rn], Rs)" },
  { op: "swp", opc: 0b1000, desc: "Rs" },
];

// (A, R) -> the ordering suffix every LSE atomic spells the same way:
// none, L (release), A (acquire), AL (both).
const ORDERINGS = [[0, 0, ""], [0, 1, "l"], [1, 0, "a"], [1, 1, "al"]];

export const CLASSES = {
  atomic_ldop: {
    name: "LDADD/LDCLR/LDEOR/LDSET/LDSMAX/LDSMIN/LDUMAX/LDUMIN, SWP",
    layout: [
      ["size", { shift: 30, width: 2 }],
      ["vfixed", { shift: 24, width: 6 }],
      ["a", { shift: 23, width: 1 }],
      ["r", { shift: 22, width: 1 }],
      ["one21", { shift: 21, width: 1 }],
      ["rs", { shift: 16, width: 5 }],
      ["opc", { shift: 12, width: 4 }],
      ["fixed10", { shift: 10, width: 2 }],
      ["rn", { shift: 5, width: 5 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
};

export const MARKERS = [
  ["atomic_ldop", [{ shift: 24, width: 6, value: 0b111000 }, { shift: 21, width: 1, value: 1 }, { shift: 10, width: 2, value: 0b00 }]],
];

export const INSTRUCTIONS = OPS.flatMap(({ op, opc, desc }) =>
  ORDERINGS.flatMap(([a, r, suffix]) =>
    [0b10, 0b11].map((size) => ({
      name: op + suffix, class: "atomic_ldop", opc, a, r, size, destWide: size === 0b11,
      desc: `Rt = old M[Rn]; M[Rn] = ${desc}`,
    }))
  )
);

export function find(cls, fields) {
  if (fields.size !== 0b10 && fields.size !== 0b11) return null; // byte/halfword forms out of scope
  return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc && i.a === fields.a && i.r === fields.r && i.size === fields.size) || null;
}
