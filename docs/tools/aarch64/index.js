// Merges every class family into the single CLASSES/MARKERS/INSTRUCTIONS
// table encode.js, decode.js and registry.js all read, and holds the
// classify/find machinery that works generically over whichever family a
// word or a typed class turns out to belong to — none of that machinery is
// specific to one family, so, unlike CLASSES/MARKERS/INSTRUCTIONS
// themselves, it does not live with any of them.
//
// An AArch64 instruction is always a 32 bit word — unlike RISC-V, there is
// no single contiguous opcode field that names the format the way RV32's
// low 7 bits do. Which fields a word has depends on its *class*, and each
// class's own identifying bits sit at a different position and width. So
// this toolbox adds one thing real hardware does not have: a `class`
// selector box the encoder reads to pick a layout, the same job RISC-V's
// opcode field does for free. It is never packed into the word — `class` is
// not one of the fields layout() returns, so encode.js reads it separately
// and leaves it out of packWord's input. The decoder, which only ever sees
// real 32 bit words, has no such shortcut: classify() re-derives the class
// from the word's own fixed bits, the way a real disassembler would.

import { sliceFields, shiftToSlice } from "../bits.js";
import { WORD_BITS } from "./fields.js";
import * as dpImm from "./dataproc-imm.js";
import * as dpReg from "./dataproc-reg.js";
import * as branch from "./branch.js";
import * as loadstore from "./loadstore.js";
import * as atomics from "./atomics.js";
import * as system from "./system.js";

export * from "./fields.js";

const MODULES = [dpImm, dpReg, branch, loadstore, atomics, system];

export const CLASSES = Object.assign({}, ...MODULES.map((m) => m.CLASSES));
export const MARKERS = MODULES.flatMap((m) => m.MARKERS);
export const INSTRUCTIONS = MODULES.flatMap((m) => m.INSTRUCTIONS);

// CLASS_KEYS is the order the toolbox's synthetic `class` selector box reads
// its bits in — shared by encode.js (to turn a typed index into a class)
// and decode.js (to turn a classified word back into that index for the
// "send to encoder" handoff). Grouped by family, in the same order the
// modules above are imported, so the encoder's class list reads as one
// story rather than jumbled.
export const CLASS_KEYS = MODULES.flatMap((m) => Object.keys(m.CLASSES));

// How wide the toolbox's own synthetic `class` selector box needs to be to
// index every class — 28 classes need 5 bits, not the 4 the original
// 9-class core fit in, so this is computed rather than assumed.
export const CLASS_SELECTOR_WIDTH = Math.ceil(Math.log2(CLASS_KEYS.length));

// CLASS_OWNER maps a class name back to the module whose find() knows it —
// each module's find() only ever matches its own classes' rows (every
// INSTRUCTIONS row it searches is filtered by `class`, and class names are
// unique across modules), so dispatching to the right one is enough.
const CLASS_OWNER = Object.fromEntries(MODULES.flatMap((m) => Object.keys(m.CLASSES).map((cls) => [cls, m])));

export function layout(cls) {
  return CLASSES[cls]?.layout || [];
}

export function slices(cls) {
  return layout(cls).map(([id, f]) => [id, shiftToSlice(f.shift, f.width, WORD_BITS)]);
}

// classifyStatus reads a 32 bit pattern's fixed marker bits and says which
// class it belongs to, the way a real disassembler walks the encoding
// table. Each class's marker is a list of independently-checked
// (shift, width, value) parts — every part must hold, and every part must
// test only bits that are truly fixed for the whole class, never a field
// that also carries real operand data (addsub_reg's shiftop and
// logical_reg's N are exactly that kind of field, which is why they are
// checked in find() instead — see each family module's own comments).
// Multiple parts exist for the classes whose one contiguous "family" prefix
// is not, by itself, unique (extract vs. its reserved siblings; addsub_reg
// vs. addsub_ext, told apart only by one bit outside the shared prefix).
//
// A field still holding a decoder's variable letters cannot be tested; when
// that is the only reason nothing matched, `unknown` says so, so a decoder
// can tell "this cannot be any class in scope" apart from "not enough of
// the word is known yet to tell" — RISC-V never needs the distinction,
// since its one opcode field is always exactly at bits 6:0.
export function classifyStatus(pattern) {
  let unknown = false;
  outer:
  for (const [cls, parts] of MARKERS) {
    for (const { shift, width, value } of parts) {
      const [from, to] = shiftToSlice(shift, width, WORD_BITS);
      const slice = pattern.slice(from, to);
      if (!/^[01]+$/.test(slice)) { unknown = true; continue outer; }
      if (parseInt(slice, 2) !== value) continue outer;
    }
    return { cls, unknown: false };
  }
  return { cls: "", unknown };
}

export function classify(pattern) {
  return classifyStatus(pattern).cls;
}

// wordFields cuts a full 32 bit pattern into the named fields the encoder's
// boxes hold, so a decoded word can be handed straight to the encoder.
// Unlike RISC-V, the class the encoder needs is not itself one of those
// fields — the caller (decode.js's extractSendable) adds it in separately.
export function wordFields(pattern) {
  const cls = classify(pattern);
  return cls ? sliceFields(pattern, slices(cls)) : null;
}

// find looks an instruction up by class and the fields that name it,
// dispatched to whichever family module owns that class — every family's
// own find() documents the extra guards its class needs (a reserved
// sub-field value, a register-width restriction, and so on) right next to
// the INSTRUCTIONS table those guards protect.
export function find(cls, fields) {
  return CLASS_OWNER[cls]?.find(cls, fields) || null;
}

// --- The encoder's instruction picker -------------------------------------
//
// KEY_FIELDS is which of an INSTRUCTIONS row's own properties are real bit
// fields that name the instruction — the same fields each family's find()
// reads back. Everything else on a row (name, desc, note, destWide, opc2,
// sfOnly) is either prose or a lookup key that is not a field of the word,
// so applyInstruction must not try to pack it.
const KEY_FIELDS = {
  addsub_imm: ["opc"], logical_imm: ["opc"], movewide: ["opc"], bitfield: ["opc"],
  extract: ["op21"], pcrel: ["op"],
  addsub_reg: ["opc"], addsub_ext: ["opc"], logical_reg: ["opc", "n"],
  condselect: ["op", "op2"], condcompare: ["op"], dp2src: ["opcode"],
  dp1src: ["opcode"], dp3src: ["op31", "o0"],
  b_bl: ["opc"], b_cond: ["opc"], cbz_cbnz: ["opc"], tbz_tbnz: ["op"],
  br_reg: ["op"],
  ldst_imm: ["size"], ldst_unscaled: ["size", "idx"], ldst_regoffset: ["size"],
  ldst_pair: ["opc", "idx", "l"], ldst_excl: ["o2", "o1", "o0", "l"],
  ldst_literal: ["opc"], atomic_ldop: ["opc", "a", "r", "size"],
  sysmisc: ["crn", "crm", "op2"], excgen: ["opc", "ll"],
};

// MARKER_FILL is every class's own fixed marker bits, read straight off the
// MARKERS table rather than repeated here — picking an instruction has to
// fill those in too, or the word would not classify as its own class.
function markerFill(cls) {
  const out = {};
  for (const [name, parts] of MARKERS) {
    if (name !== cls) continue;
    for (const { shift, width, value } of parts) {
      // Find the layout field this marker part sits inside, and place the
      // marker's bits at the right offset within it — a marker is described
      // in word coordinates, a box holds a whole field.
      for (const [id, f] of layout(cls)) {
        if (shift < f.shift || shift + width > f.shift + f.width) continue;
        const held = out[id] ?? 0;
        out[id] = held | (value << (shift - f.shift));
        break;
      }
    }
  }
  return out;
}

const bin = (n, width) => (n >>> 0).toString(2).padStart(width, "0");

// PICKER_INSTRUCTIONS is INSTRUCTIONS with a label that is unique across the
// whole table. A bare mnemonic is not: `ldr` alone is ten rows across four
// classes, and 60 mnemonics here name more than one encoding — so a row that
// shares its name says which class (and, where a class holds several rows of
// one name, which addressing mode) it is, and that label is what the picker
// matches on. Rows whose mnemonic is already unique keep it bare, so typing
// `movz` still just works.
const NAME_COUNTS = INSTRUCTIONS.reduce((m, i) => m.set(i.name, (m.get(i.name) || 0) + 1), new Map());

const IDX_NAMES = { 0: "unscaled", 1: "post-indexed", 3: "pre-indexed" };
const PAIR_IDX_NAMES = { 1: "post-indexed", 2: "offset", 3: "pre-indexed" };
const SIZE_NAMES = { 0: "byte", 1: "halfword", 2: "word", 3: "doubleword" };

// qualify is the readable half: a mnemonic that names one encoding is left
// bare, and one that does not says which class — and, for the load/store
// families where a class still holds several rows of one name, which
// addressing mode and access width.
function qualify(inst) {
  if (NAME_COUNTS.get(inst.name) === 1) return inst.name;
  const parts = [CLASSES[inst.class].name];
  if (inst.class === "ldst_unscaled") parts.push(IDX_NAMES[inst.idx]);
  if (inst.class === "ldst_pair") parts.push(PAIR_IDX_NAMES[inst.idx]);
  if (inst.destWide !== undefined) parts.push(inst.destWide ? "64 bit" : "32 bit");
  else if (inst.size !== undefined) parts.push(SIZE_NAMES[inst.size]);
  return `${inst.name} — ${parts.filter(Boolean).join(", ")}`;
}

// A label the picker cannot tell apart is a row the picker cannot reach, so
// uniqueness is enforced rather than hoped for: anything still sharing a
// label after qualify() gets the fields that actually differ across the rows
// sharing it appended, whatever those fields happen to be. That holds for
// tables this file has not seen yet, which is the point — the old picker lost
// 111 of these 244 rows precisely because nothing checked.
function disambiguate(rows) {
  if (rows.length === 1) return;
  const keys = new Set(rows.flatMap((r) => Object.keys(r.inst)));
  const differing = [...keys].filter((k) => {
    if (typeof rows[0].inst[k] === "string") return false; // name/desc/note: prose, not a field
    return new Set(rows.map((r) => r.inst[k])).size > 1;
  });
  for (const row of rows) {
    const tail = differing.map((k) => `${k}=${row.inst[k]}`).join(" ");
    if (tail) row.label += ` · ${tail}`;
  }
}

export const PICKER_INSTRUCTIONS = (() => {
  const rows = INSTRUCTIONS.map((inst) => ({ inst, label: qualify(inst) }));
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.label) || [];
    list.push(row);
    groups.set(row.label, list);
  }
  for (const list of groups.values()) disambiguate(list);
  return rows.map(({ inst, label }) => ({ ...inst, pickerLabel: label }));
})();

// OPERAND_DEFAULTS are the few fields that are not marker bits and not part
// of what names a row, but that still have to hold something legal before the
// word decodes as anything at all — the reserved values each family's find()
// rejects. Picking an instruction should always leave a decodable skeleton
// with only its real operands still to fill in, so these come pre-set to the
// most ordinary choice and stay editable like any other box.
const OPERAND_DEFAULTS = {
  br_reg: { op2: 0b11111, op3: 0, op4: 0 },   // every other combination is reserved
  sysmisc: { rt: 0b11111 },                    // fixed for every hint and barrier
  ldst_excl: { size: 0b11 },                   // byte/halfword forms are out of scope
  ldst_regoffset: { option: 0b011 },           // LSL — the plain [Xn, Xm] addressing
};

// applyInstruction writes an instruction's own bits into the encoder's boxes:
// the toolbox's synthetic class selector first (which is what makes the row
// change shape into that class's layout), then the class's fixed marker bits,
// then the fields that name this row. Operand fields are deliberately left
// alone — that is what the caret is sent to next.
export function applyInstruction(inst, values) {
  const cls = inst.class;
  values.class = bin(CLASS_KEYS.indexOf(cls), CLASS_SELECTOR_WIDTH);

  const widths = Object.fromEntries(layout(cls).map(([id, f]) => [id, f.width]));
  const write = (id, value) => {
    if (widths[id] === undefined) return;
    values[id] = bin(value, widths[id]);
  };

  for (const [id, value] of Object.entries(markerFill(cls))) write(id, value);
  for (const [id, value] of Object.entries(OPERAND_DEFAULTS[cls] || {})) write(id, value);
  for (const id of KEY_FIELDS[cls] || []) {
    if (inst[id] !== undefined) write(id, inst[id]);
  }
  // ldst_imm/regoffset/unscaled key off opc2, a 2 bit sub-field sitting at the
  // bottom of a wider opc box that also holds the class marker; ldst_unscaled
  // and ldst_regoffset hold it alone. sfOnly-tagged rows only exist at one
  // register width, so sf is part of naming them.
  if (inst.opc2 !== undefined) {
    if (cls === "ldst_imm") write("opc", ((markerFill(cls).opc ?? 0) >> 2 << 2) | inst.opc2);
    else write("opc", inst.opc2);
  }
  if (inst.sfOnly !== undefined) write("sf", inst.sfOnly);
}
