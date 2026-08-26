// The decoder reads a word back. Bits it cannot know are welcome: any letter
// stands for a variable, so a pattern with letters in it decodes into the
// fields it does pin down, and names the letters for the rest.
//
// Unlike RISC-V, knowing the class is not as simple as reading one field at a
// fixed spot: classifyStatus (aarch64.js) tries every class's own marker
// bits and says whether nothing fits, or whether it is simply too soon to
// tell — see its own comment for why AArch64 needs that second case at all.

import { cleanBits, patternValue as value, variableName, wordPattern } from "./bits.js";
import * as a from "./aarch64.js";

const unknown = (slice) => `variable ${variableName(slice)}`;

// register spells a register field out, or names the letter standing in for
// it when the decoder could not pin it down.
function register(slice, sf, sp) {
  const [n, ok] = value(slice);
  if (!ok) return unknown(slice);
  return a.regName(n, sf, sp);
}

const SHIFT_NAMES_ADDSUB = ["lsl", "lsr", "asr", "reserved"];
const SHIFT_NAMES_LOGICAL = ["lsl", "lsr", "asr", "ror"];

// The fields that decide the mnemonic, per class — find() needs every one of
// these to be known before it can be trusted.
const SELECTORS = {
  b_bl: ["opc"],
  b_cond: ["opc"],
  cbz_cbnz: ["opc"],
  addsub_imm: ["opc"],
  logical_imm: ["opc"],
  movewide: ["opc"],
  addsub_reg: ["opc", "shiftop"],
  logical_reg: ["opc", "n"],
  ldst_imm: ["size", "opc"],
};

const SELECTOR_LABEL = { opc: "opc", shiftop: "shift/extend bits", n: "N", size: "size" };

export function decodeAarch64(input) {
  const text = cleanBits(input.word || "");
  if (text === "") return [];

  const pattern = wordPattern(text, input.read, a.WORD_BITS);
  const fields = [{ label: "Bits", value: pattern, format: "bits" }];

  const { cls, unknown: blocked } = a.classifyStatus(pattern);
  if (!cls) {
    fields.push({
      label: "Class",
      value: blocked
        ? "needs more of the word's fixed marker bits to be known before the class can be told"
        : "no class in scope matches these bits",
    });
    fields.push({ label: "Instruction", value: "needs the class to be known" });
    return fields;
  }
  fields.push({ label: "Class", value: a.CLASSES[cls].name });

  // Cut the word up the way this class says, keeping both the numeric value
  // (0 where unknown) and the raw slice (to name the letters in when it is).
  const at = {};
  const f = {};
  for (const [id, [from, to]] of a.slices(cls)) {
    at[id] = pattern.slice(from, to);
    f[id] = value(at[id])[0];
  }
  const readable = (id) => /^[01]+$/.test(at[id]);
  // ldst_imm has no sf field of its own — register width there comes from
  // size instead: byte/halfword/word loads and stores always use a W
  // register, and only the doubleword size (size=11) uses X.
  const sf = cls === "ldst_imm" ? f.size === 0b11 : f.sf === 1;

  const selectors = SELECTORS[cls];
  const selectorsKnown = selectors.every(readable);
  const inst = selectorsKnown ? a.find(cls, f) : null;

  if (!selectorsKnown) {
    const need = selectors.filter((id) => !readable(id)).map((id) => SELECTOR_LABEL[id]).join(" and ");
    fields.push({ label: "Instruction", value: `needs ${need} to be known` });
    return fields;
  }
  if (!inst) {
    fields.push({ label: "Instruction", value: "no instruction in scope has these fields" });
    return fields;
  }

  // immText resolves one field to display text via fmt(numericValue), or to
  // the letter standing in for it when the decoder could not read it.
  const immText = (id, fmt) => (readable(id) ? fmt(f[id]) : unknown(at[id]));

  let mnemonic = inst.name;
  let operands = "";
  let effect = "";
  const extra = [];

  switch (cls) {
    case "b_bl": {
      const off = immText("imm26", (n) => `#${a.branchOffset(n, 26)}`);
      operands = off;
      effect = readable("imm26")
        ? (inst.name === "bl" ? `x30 = pc + 4; pc = pc + ${a.branchOffset(f.imm26, 26)}` : `pc = pc + ${a.branchOffset(f.imm26, 26)}`)
        : `pc = pc + ${off}`;
      break;
    }
    case "b_cond": {
      mnemonic = `b.${a.condName(f.cond)}`;
      const off = immText("imm19", (n) => `#${a.branchOffset(n, 19)}`);
      operands = off;
      effect = `if (${a.CONDITIONS[f.cond]?.[1] ?? `cond${f.cond}`}) pc = pc + ${off}`;
      break;
    }
    case "cbz_cbnz": {
      const rt = register(at.rt, sf, false);
      fields.push({ label: "rt", value: rt });
      const off = immText("imm19", (n) => `#${a.branchOffset(n, 19)}`);
      operands = `${rt}, ${off}`;
      effect = `if (${rt} ${inst.name === "cbz" ? "==" : "!="} 0) pc = pc + ${off}`;
      break;
    }
    case "addsub_imm": {
      const rd = register(at.rd, sf, true);
      const rn = register(at.rn, sf, true);
      fields.push({ label: "rn", value: rn }, { label: "rd", value: rd });
      const shOk = readable("sh") && readable("imm12");
      const value12 = shOk ? f.imm12 << (f.sh ? 12 : 0) : null;
      const immOp = shOk ? `#${value12}` : "needs sh and imm12 to be known";
      operands = `${rd}, ${rn}, ${immOp}`;
      effect = shOk ? `${rd} = ${rn} ${inst.name === "add" ? "+" : "-"} ${value12}` : `${rd} = ${rn} ${inst.name === "add" ? "+" : "-"} ${immOp}`;
      if (shOk && f.sh) extra.push({ label: "Immediate", value: `imm12 (${f.imm12}) << 12 = ${value12} — sh is set` });
      break;
    }
    case "logical_imm": {
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      fields.push({ label: "rn", value: rn }, { label: "rd", value: rd });
      const op = { and: "&", orr: "|", eor: "^" }[inst.name];
      if (!readable("n") || !readable("immr") || !readable("imms")) {
        operands = `${rd}, ${rn}, needs N, immr and imms to be known`;
        effect = `${rd} = ${rn} ${op} ${operands.split(", ").pop()}`;
      } else {
        try {
          const v = a.decodeBitMasks(f.n, f.immr, f.imms, sf ? 64 : 32);
          operands = `${rd}, ${rn}, #${a.hexNum(v)}`;
          effect = `${rd} = ${rn} ${op} ${a.hexNum(v)}`;
        } catch (e) {
          fields.push({ label: "Instruction", value: `${mnemonic} ${rd}, ${rn}, <n/immr/imms>` });
          fields.push({ label: "Immediate", value: e.message });
          return fields;
        }
      }
      break;
    }
    case "movewide": {
      const rd = register(at.rd, sf, false);
      fields.push({ label: "rd", value: rd });
      const hwOk = readable("hw");
      const shift = hwOk ? f.hw * 16 : null;
      const imm16Text = immText("imm16", (n) => `#${a.hexNum(n)}`);
      const shiftSuffix = hwOk ? (shift ? `, lsl #${shift}` : "") : ", lsl #<hw*16>";
      operands = `${rd}, ${imm16Text}${shiftSuffix}`;
      if (hwOk && readable("imm16")) {
        const shifted = BigInt(f.imm16) << BigInt(shift);
        if (inst.name === "movz") effect = `${rd} = ${a.hexNum(shifted)}`;
        else if (inst.name === "movn") {
          const width = sf ? 64n : 32n;
          const mask = (1n << width) - 1n;
          effect = `${rd} = NOT(${a.hexNum(f.imm16)} << ${shift}) = ${a.hexNum((~shifted) & mask)}`;
        } else effect = `${rd}[${shift + 15}:${shift}] = ${a.hexNum(f.imm16)}, the rest of ${rd} unchanged`;
      } else {
        effect = `${rd} = ${imm16Text}${shiftSuffix}`;
      }
      break;
    }
    case "addsub_reg": {
      const rd = register(at.rd, sf, true);
      const rn = register(at.rn, sf, true);
      const rm = register(at.rm, sf, false);
      fields.push({ label: "rn", value: rn }, { label: "rm", value: rm }, { label: "rd", value: rd });
      const shiftType = SHIFT_NAMES_ADDSUB[f.shiftop >> 1];
      const amtOk = readable("imm6");
      const shiftSuffix = amtOk ? (f.imm6 ? `, ${shiftType} #${f.imm6}` : "") : `, ${shiftType} #<imm6>`;
      operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
      const shiftedRm = amtOk ? (f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm) : `${shiftType}(${rm}, <imm6>)`;
      effect = `${rd} = ${rn} ${inst.name === "add" ? "+" : "-"} ${shiftedRm}`;
      break;
    }
    case "logical_reg": {
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      const rm = register(at.rm, sf, false);
      fields.push({ label: "rn", value: rn }, { label: "rm", value: rm }, { label: "rd", value: rd });
      const shiftType = SHIFT_NAMES_LOGICAL[f.shift];
      const amtOk = readable("imm6");
      const shiftSuffix = amtOk ? (f.imm6 ? `, ${shiftType} #${f.imm6}` : "") : `, ${shiftType} #<imm6>`;
      operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
      const op = { and: "&", orr: "|", eor: "^" }[inst.name];
      const shiftedRm = amtOk ? (f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm) : `${shiftType}(${rm}, <imm6>)`;
      effect = `${rd} = ${rn} ${op} ${shiftedRm}`;
      break;
    }
    case "ldst_imm": {
      const rt = register(at.rt, sf, false);
      // The base register is always 64 bit (X or SP) here, independent of
      // the transfer size sf follows — see encode.js's matching comment.
      const rn = register(at.rn, true, true);
      fields.push({ label: "rn", value: rn }, { label: "rt", value: rt });
      const scale = 1 << f.size;
      const offOk = readable("imm12");
      const offset = offOk ? f.imm12 * scale : null;
      const addr = offOk ? (offset ? `[${rn}, #${offset}]` : `[${rn}]`) : `[${rn}, #<imm12 × ${scale}>]`;
      operands = `${rt}, ${addr}`;
      effect = inst.name.startsWith("st") ? `M[${rn} + ${offOk ? offset : "?"}] = ${rt}` : `${rt} = M[${rn} + ${offOk ? offset : "?"}]`;
      if (offOk && f.imm12 && scale > 1) extra.push({ label: "Offset", value: `imm12 (${f.imm12}) × ${scale} bytes = ${offset}` });
      break;
    }
  }

  fields.push(
    { label: "Instruction", value: operands ? `${mnemonic} ${operands}` : mnemonic },
    { label: "Effect", value: effect + (inst.note ? ` — ${inst.note}` : "") },
    ...extra,
  );
  return fields;
}

// extractSendableAarch64 is this toolbox's version of isa-toolkit's
// sendableFromBits: hand the encoder's boxes over only once every bit of the
// word is known. It cannot just be sendableFromBits(res, WORD_BITS,
// wordFields), though — the encoder's segmented row also needs the `class`
// box filled in, and that box is not one of wordFields' fields (it is not
// part of the word at all, see aarch64.js's header comment), so it has to be
// added in here instead.
export function extractSendableAarch64(res) {
  const bits = res.fields?.find((f) => f.label === "Bits")?.value;
  if (!bits || !/^[01]{32}$/.test(bits)) return null;
  const cls = a.classify(bits);
  if (!cls) return null;
  const idx = a.CLASS_KEYS.indexOf(cls);
  const classBits = idx.toString(2).padStart(4, "0");
  return { class: classBits, ...a.wordFields(bits) };
}
