// The encoder: one box per field of the word, and the integer to feed the
// machine underneath. Unlike RISC-V, the box that picks the layout (`class`)
// is not itself part of the word — see aarch64.js's header comment — so it
// is read separately and left out of what packWord packs.

import { bitsField, packWord, wordBits, hexWord } from "./bits.js";
import * as a from "./aarch64.js";

const SHIFT_NAMES_ADDSUB = ["lsl", "lsr", "asr", "reserved"];
const SHIFT_NAMES_LOGICAL = ["lsl", "lsr", "asr", "ror"];

const imm = (n) => `#${n}`;
const hexImm = (n) => `#${a.hexNum(n)}`;

export function encodeAarch64(input) {
  const classIdx = bitsField(input, "class", 4);
  const cls = a.CLASS_KEYS[classIdx];
  if (!cls) {
    return [{ label: "Class", value: `${classIdx} is not a class this toolbox knows — pick 0-${a.CLASS_KEYS.length - 1}` }];
  }

  const { word, fields: f } = packWord(a.layout(cls), input);

  const fields = [
    { label: "Int", value: String(word >>> 0) },
    { label: "Hex", value: hexWord(word, a.WORD_BITS) },
    { label: "Bits", value: wordBits(word, a.WORD_BITS), format: "bits" },
    { label: "Class", value: a.CLASSES[cls].name },
  ];

  const inst = a.find(cls, f);
  if (!inst) {
    fields.push({ label: "Instruction", value: "no instruction in scope has these fields" });
    return fields;
  }

  // ldst_imm has no sf field of its own — register width there comes from
  // size instead: byte/halfword/word loads and stores always use a W
  // register, and only the doubleword size (size=11) uses X.
  const sf = cls === "ldst_imm" ? f.size === 0b11 : f.sf === 1;
  const reg = (n, sp) => a.regName(n, sf, sp);

  let mnemonic = inst.name;
  let operands = "";
  let effect = "";
  const extra = [];

  switch (cls) {
    case "b_bl": {
      const off = a.branchOffset(f.imm26, 26);
      operands = imm(off);
      effect = inst.name === "bl"
        ? `x30 = pc + 4; pc = pc + ${off}`
        : `pc = pc + ${off}`;
      break;
    }
    case "b_cond": {
      const off = a.branchOffset(f.imm19, 19);
      mnemonic = `b.${a.condName(f.cond)}`;
      operands = imm(off);
      effect = `if (${a.CONDITIONS[f.cond]?.[1] ?? `cond${f.cond}`}) pc = pc + ${off}`;
      break;
    }
    case "cbz_cbnz": {
      const off = a.branchOffset(f.imm19, 19);
      const rt = reg(f.rt, false);
      operands = `${rt}, ${imm(off)}`;
      effect = `if (${rt} ${inst.name === "cbz" ? "==" : "!="} 0) pc = pc + ${off}`;
      break;
    }
    case "addsub_imm": {
      const rd = reg(f.rd, true);
      const rn = reg(f.rn, true);
      const value = f.imm12 << (f.sh ? 12 : 0);
      operands = `${rd}, ${rn}, ${imm(value)}`;
      effect = `${rd} = ${rn} ${inst.name === "add" ? "+" : "-"} ${value}`;
      if (f.sh) extra.push({ label: "Immediate", value: `imm12 (${f.imm12}) << 12 = ${value} — sh is set` });
      break;
    }
    case "logical_imm": {
      const rd = reg(f.rd, false);
      const rn = reg(f.rn, false);
      const datasize = sf ? 64 : 32;
      let value;
      try {
        value = a.decodeBitMasks(f.n, f.immr, f.imms, datasize);
      } catch (e) {
        fields.push({ label: "Instruction", value: `${mnemonic} ${rd}, ${rn}, <n/immr/imms>` });
        fields.push({ label: "Immediate", value: e.message });
        return fields;
      }
      operands = `${rd}, ${rn}, ${hexImm(value)}`;
      const op = { and: "&", orr: "|", eor: "^" }[inst.name];
      effect = `${rd} = ${rn} ${op} ${a.hexNum(value)}`;
      break;
    }
    case "movewide": {
      const rd = reg(f.rd, false);
      const shift = f.hw * 16;
      const shiftSuffix = shift ? `, lsl #${shift}` : "";
      operands = `${rd}, ${hexImm(f.imm16)}${shiftSuffix}`;
      const shifted = BigInt(f.imm16) << BigInt(shift);
      if (inst.name === "movz") {
        effect = `${rd} = ${a.hexNum(shifted)}`;
      } else if (inst.name === "movn") {
        const width = sf ? 64n : 32n;
        const mask = (1n << width) - 1n;
        effect = `${rd} = NOT(${a.hexNum(f.imm16)} << ${shift}) = ${a.hexNum((~shifted) & mask)}`;
      } else {
        effect = `${rd}[${shift + 15}:${shift}] = ${a.hexNum(f.imm16)}, the rest of ${rd} unchanged`;
      }
      break;
    }
    case "addsub_reg": {
      const rd = reg(f.rd, true);
      const rn = reg(f.rn, true);
      const rm = reg(f.rm, false);
      const shiftType = SHIFT_NAMES_ADDSUB[f.shiftop >> 1];
      const shiftSuffix = f.imm6 ? `, ${shiftType} #${f.imm6}` : "";
      operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
      const shiftedRm = f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm;
      effect = `${rd} = ${rn} ${inst.name === "add" ? "+" : "-"} ${shiftedRm}`;
      break;
    }
    case "logical_reg": {
      const rd = reg(f.rd, false);
      const rn = reg(f.rn, false);
      const rm = reg(f.rm, false);
      const shiftType = SHIFT_NAMES_LOGICAL[f.shift];
      const shiftSuffix = f.imm6 ? `, ${shiftType} #${f.imm6}` : "";
      operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
      const op = { and: "&", orr: "|", eor: "^" }[inst.name];
      const shiftedRm = f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm;
      effect = `${rd} = ${rn} ${op} ${shiftedRm}`;
      break;
    }
    case "ldst_imm": {
      const rt = reg(f.rt, false);
      // The base register is always 64 bit (X or SP), independent of the
      // transfer size sf follows here — `strb w0, [x1]` addresses through
      // x1, never w1, even though the data register is 32 bit.
      const rn = a.regName(f.rn, true, true);
      const scale = 1 << f.size;
      const offset = f.imm12 * scale;
      const addr = offset ? `[${rn}, ${imm(offset)}]` : `[${rn}]`;
      operands = `${rt}, ${addr}`;
      effect = inst.name.startsWith("st")
        ? `M[${rn} + ${offset}] = ${rt}`
        : `${rt} = M[${rn} + ${offset}]`;
      if (f.imm12 && scale > 1) extra.push({ label: "Offset", value: `imm12 (${f.imm12}) × ${scale} bytes = ${offset}` });
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
