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
