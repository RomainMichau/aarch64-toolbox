// Barriers, hints, and the exception-generating instructions — the small,
// mostly-fixed-encoding instructions a modern CPU still needs even though
// none of them touch a general-purpose register the way everything else in
// this toolbox does. Two classes, not the one the "barriers / misc system"
// grouping suggests: hints/barriers and exception-generation are genuinely
// different real encodings (a different fixed prefix, a different operand
// shape), the same way this toolbox already keeps CBZ and B.cond apart even
// though both are "conditional-ish branches" in spirit.

export const CLASSES = {
  // NOP/YIELD/WFE/WFI/SEV/SEVL (hints) and DMB/DSB/ISB (barriers) — one
  // "system instruction with no register operand" shape, verified against
  // NOP=0xD503201F (very well known), and DSB SY / ISB SY derived from it
  // field by field (0xD5033F9F / 0xD5033FDF) — CRn (0010 vs 0011) tells the
  // two groups apart, the same way it tells every other system-instruction
  // subgroup apart in the real encoding (MRS/MSR use a different CRn
  // pattern entirely, so they never classify as this class — see the
  // toolbox's declared scope, which leaves them out).
  sysmisc: {
    name: "Hints (NOP, ...) and barriers (DMB, DSB, ISB)",
    layout: [
      ["fixed", { shift: 16, width: 16 }],
      ["crn", { shift: 12, width: 4 }],
      ["crm", { shift: 8, width: 4 }],
      ["op2", { shift: 5, width: 3 }],
      ["rt", { shift: 0, width: 5 }],
    ],
  },
  // SVC, BRK, HLT — verified against `svc #0`=0xD4000001, `brk #0`=
  // 0xD4200000 (both extremely well known trap encodings), and `hlt #0`=
  // 0xD4400000 derived the same field-by-field way from them.
  excgen: {
    name: "SVC / BRK / HLT",
    layout: [
      ["fixed", { shift: 24, width: 8 }],
      ["opc", { shift: 21, width: 3 }],
      ["imm16", { shift: 5, width: 16 }],
      ["opc2", { shift: 2, width: 3 }],
      ["ll", { shift: 0, width: 2 }],
    ],
  },
};

export const MARKERS = [
  ["sysmisc", [{ shift: 16, width: 16, value: 0xD503 }]],
  ["excgen", [{ shift: 24, width: 8, value: 0xD4 }, { shift: 2, width: 3, value: 0b000 }]],
];

const HINTS = [
  { op2: 0b000, name: "nop", desc: "no operation" },
  { op2: 0b001, name: "yield", desc: "hint that this hardware thread could usefully yield to another" },
  { op2: 0b010, name: "wfe", desc: "wait for event: sleep until an event register/signal wakes this core" },
  { op2: 0b011, name: "wfi", desc: "wait for interrupt: sleep until an interrupt (or debug event) wakes this core" },
  { op2: 0b100, name: "sev", desc: "signal an event to every core" },
  { op2: 0b101, name: "sevl", desc: "signal an event to this core alone" },
];

const BARRIERS = [
  { op2: 0b100, name: "dsb", desc: "data synchronization barrier: wait for every earlier memory access to complete" },
  { op2: 0b101, name: "dmb", desc: "data memory barrier: order every earlier memory access before every later one" },
  { op2: 0b110, name: "isb", desc: "instruction synchronization barrier: flush this core's instruction pipeline" },
];

export const INSTRUCTIONS = [
  ...HINTS.map(({ op2, name, desc }) => ({ name, class: "sysmisc", crn: 0b0010, crm: 0b0000, op2, desc })),
  ...BARRIERS.map(({ op2, name, desc }) => ({ name, class: "sysmisc", crn: 0b0011, crm: 0b1111, op2, desc })),
  { name: "svc", class: "excgen", opc: 0b000, ll: 0b01, desc: "raise a supervisor call exception, entering EL1" },
  { name: "brk", class: "excgen", opc: 0b001, ll: 0b00, desc: "raise a breakpoint exception (software breakpoint / debugger trap)" },
  { name: "hlt", class: "excgen", opc: 0b010, ll: 0b00, desc: "halt, entering debug state (used by debuggers and as a hard trap)" },
];

export function find(cls, fields) {
  if (cls === "sysmisc") {
    if (fields.rt !== 0b11111) return null; // Rt is fixed 11111 for every hint/barrier
    return INSTRUCTIONS.find((i) => i.class === cls && i.crn === fields.crn && i.crm === fields.crm && i.op2 === fields.op2) || null;
  }
  return INSTRUCTIONS.find((i) => i.class === cls && i.opc === fields.opc && i.ll === fields.ll) || null;
}
