// The decoder reads a word back. Bits it cannot know are welcome: any letter
// stands for a variable, so a pattern with letters in it decodes into the
// fields it does pin down, and names the letters for the rest.
//
// Unlike RISC-V, knowing the class is not as simple as reading one field at a
// fixed spot: classifyStatus (aarch64.js) tries every class's own marker
// bits and says whether nothing fits, or whether it is simply too soon to
// tell — see its own comment for why AArch64 needs that second case at all.
//
// Once the class is known, naming the exact instruction can still need more
// than one field (addsub_ext needs opt and opc, condselect needs op and
// op2, and so on) — SELECTORS below lists exactly which fields each class's
// own find() reads, so this file can tell "found" from "needs more of the
// word" the same way it already did for the original 9 classes.
//
// Aliases that depend on a relationship between fields (CMP is SUBS with
// Rd=WZR/XZR, CSET is CSINC with Rn=Rm=WZR/XZR and an invertible cond, the
// bitfield family's SXTB/LSL/UBFX/...) are only resolved once every field
// that relationship reads is itself known — otherwise the base mnemonic and
// its plain fields are shown, the same restraint logical_imm's bitmask
// decode already used before this expansion.

import { cleanBits, patternValue as value, variableName, wordPattern } from "./bits.js";
import * as a from "./aarch64.js";
import { bitfieldAlias } from "./aarch64/dataproc-imm.js";

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
const EXTEND_NAMES = ["uxtb", "uxth", "uxtw", "uxtx", "sxtb", "sxth", "sxtw", "sxtx"];
const invertibleCond = (cond) => cond !== 0b1110 && cond !== 0b1111;

// The fields that decide the mnemonic, per class — find() needs every one
// of these to be known before it can be trusted. See each family module's
// own find() for why a class needs more than its one obvious opc-shaped
// field (addsub_ext's reserved-opt guard, condselect's reserved op2 values,
// dp1src/dp3src keying off sf as well as their opcode, and so on).
const SELECTORS = {
  addsub_imm: ["opc"], logical_imm: ["opc"], movewide: ["opc"], bitfield: ["opc"],
  extract: ["op21"], pcrel: ["op"],
  addsub_reg: ["opc"], addsub_ext: ["opt", "opc"], logical_reg: ["opc", "n"],
  condselect: ["op", "op2"], condcompare: ["op"], dp2src: ["opcode"],
  dp1src: ["opcode2", "sf", "opcode"], dp3src: ["sf", "op31", "o0"],
  b_bl: ["opc"], b_cond: ["opc"], cbz_cbnz: ["opc"], tbz_tbnz: ["op"],
  br_reg: ["op2", "op3", "op4", "op"],
  ldst_imm: ["size", "opc"], ldst_unscaled: ["idx", "size", "opc"],
  ldst_regoffset: ["option", "size", "opc"], ldst_pair: ["opc", "idx", "l"],
  ldst_excl: ["size", "o2", "o1", "o0", "l"], ldst_literal: ["opc"],
  atomic_ldop: ["size", "opc", "a", "r"],
  sysmisc: ["rt", "crn", "crm", "op2"], excgen: ["opc", "ll"],
};

const SELECTOR_LABEL = {
  opc: "opc", n: "N", op21: "o0/op21", op: "op", opt: "opt", op2: "op2",
  opcode: "opcode", opcode2: "opcode2", sf: "sf", op31: "op31", o0: "o0",
  size: "size", idx: "idx", option: "extend option", l: "L",
  o2: "o2", o1: "o1", a: "A", r: "R", rt: "Rt", crn: "CRn", crm: "CRm", ll: "LL",
};

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

  const at = {};
  const f = {};
  for (const [id, [from, to]] of a.slices(cls)) {
    at[id] = pattern.slice(from, to);
    f[id] = value(at[id])[0];
  }
  const readable = (id) => /^[01]+$/.test(at[id]);
  const immText = (id, fmt) => (readable(id) ? fmt(f[id]) : unknown(at[id]));

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

  let mnemonic = inst.name;
  let operands = "";
  let effect = "";
  const extra = [];
  // push adds one field-breakdown row (rn: x3, rm: variable m, ...) — every
  // case below pushes each register/selector field it reads, right after
  // computing it, regardless of which alias ends up choosing the mnemonic.
  const push = (label, value) => fields.push({ label, value });

  switch (cls) {
    // --- Data processing (immediate) ---------------------------------
    case "addsub_imm": {
      const sf = f.sf === 1;
      const sub = inst.name.startsWith("sub");
      const rn = register(at.rn, sf, true);
      const rd = register(at.rd, sf, true);
      push("rn", rn);
      push("rd", rd);
      const shOk = readable("sh") && readable("imm12");
      const value12 = shOk ? f.imm12 << (f.sh ? 12 : 0) : null;
      const immOp = shOk ? `#${value12}` : "needs sh and imm12 to be known";
      if (readable("rd") && f.rd === 31) {
        mnemonic = sub ? "cmp" : "cmn";
        operands = `${rn}, ${immOp}`;
        effect = `flags = flagsOf(${rn} ${sub ? "-" : "+"} ${immOp})`;
      } else {
        operands = `${rd}, ${rn}, ${immOp}`;
        effect = `${rd} = ${rn} ${sub ? "-" : "+"} ${immOp}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      if (shOk && f.sh) extra.push({ label: "Immediate", value: `imm12 (${f.imm12}) << 12 = ${value12} — sh is set` });
      break;
    }
    case "logical_imm": {
      const sf = f.sf === 1;
      const rn = register(at.rn, sf, false);
      const rd = register(at.rd, sf, false);
      push("rn", rn);
      push("rd", rd);
      const op = { and: "&", orr: "|", eor: "^", ands: "&" }[inst.name];
      const bitmaskKnown = readable("n") && readable("immr") && readable("imms");
      let valueText = "needs N, immr and imms to be known";
      let valueNum = null;
      if (bitmaskKnown) {
        try {
          valueNum = a.decodeBitMasks(f.n, f.immr, f.imms, sf ? 64 : 32);
          valueText = a.hexNum(valueNum);
        } catch (e) {
          fields.push({ label: "Instruction", value: `${mnemonic} ${rd}, ${rn}, <n/immr/imms>` });
          fields.push({ label: "Immediate", value: e.message });
          return fields;
        }
      }
      if (inst.name === "ands" && readable("rd") && f.rd === 31) {
        mnemonic = "tst";
        operands = `${rn}, #${valueText}`;
        effect = `flags = flagsOf(${rn} & ${valueText})`;
      } else if (inst.name === "orr" && readable("rn") && f.rn === 31) {
        mnemonic = "mov";
        operands = `${rd}, #${valueText}`;
        effect = `${rd} = ${valueText}`;
      } else {
        operands = `${rd}, ${rn}, #${valueText}`;
        effect = `${rd} = ${rn} ${op} ${valueText}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      break;
    }
    case "movewide": {
      const sf = f.sf === 1;
      const rd = register(at.rd, sf, false);
      push("rd", rd);
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
    case "bitfield": {
      const sf = f.sf === 1;
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      push("rn", rn);
      push("rd", rd);
      const aliasKnown = readable("immr") && readable("imms");
      if (aliasKnown) {
        const alias = bitfieldAlias(sf, f.opc, f.immr, f.imms);
        const rnDisplay = alias.narrowSrc ? register(at.rn, false, false) : rn;
        mnemonic = alias.name;
        operands = "shift" in alias ? `${rd}, ${rnDisplay}, #${alias.shift}`
          : "lsb" in alias ? `${rd}, ${rnDisplay}, #${alias.lsb}, #${alias.width}`
          : `${rd}, ${rnDisplay}`;
        effect = `${mnemonic} ${operands}`.replace(/#/g, "");
      } else {
        operands = `${rd}, ${rn}, needs immr and imms to be known`;
        effect = operands;
      }
      break;
    }
    case "extract": {
      const sf = f.sf === 1;
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      const rm = register(at.rm, sf, false);
      push("rn", rn);
      push("rm", rm);
      push("rd", rd);
      const sameKnown = readable("rn") && readable("rm") && f.rn === f.rm;
      const lsbText = immText("lsb", (n) => `#${n}`);
      if (sameKnown) {
        mnemonic = "ror";
        operands = `${rd}, ${rn}, ${lsbText}`;
        effect = `${rd} = ${rn} rotated right by ${lsbText}`;
      } else {
        operands = `${rd}, ${rn}, ${rm}, ${lsbText}`;
        effect = `${rd} = (${rn}:${rm}) bits starting at ${lsbText}`;
      }
      break;
    }
    case "pcrel": {
      const rd = register(at.rd, true, false);
      push("rd", rd);
      const known = readable("immhi") && readable("immlo");
      const imm21 = known ? a.signExtend((f.immhi << 2) | f.immlo, 21) : null;
      const immOp = known ? `#${inst.name === "adrp" ? imm21 * 4096 : imm21}` : "needs immhi and immlo to be known";
      operands = `${rd}, ${immOp}`;
      effect = known
        ? (inst.name === "adrp" ? `${rd} = (PC & ~0xFFF) + ${imm21 * 4096}` : `${rd} = PC + ${imm21}`)
        : `${rd} = ${immOp}`;
      break;
    }

    // --- Data processing (register) -----------------------------------
    case "addsub_reg": {
      const sf = f.sf === 1;
      const sub = inst.name.startsWith("sub");
      const rn = register(at.rn, sf, true);
      const rm = register(at.rm, sf, false);
      const rd = register(at.rd, sf, true);
      push("rn", rn);
      push("rm", rm);
      push("rd", rd);
      const amtOk = readable("imm6");
      const shiftType = SHIFT_NAMES_ADDSUB[f.shiftop >> 1];
      const shiftSuffix = amtOk ? (f.imm6 ? `, ${shiftType} #${f.imm6}` : "") : `, ${shiftType} #<imm6>`;
      const shiftedRm = amtOk ? (f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm) : `${shiftType}(${rm}, <imm6>)`;
      if (readable("rd") && f.rd === 31) {
        mnemonic = sub ? "cmp" : "cmn";
        operands = `${rn}, ${rm}${shiftSuffix}`;
        effect = `flags = flagsOf(${rn} ${sub ? "-" : "+"} ${shiftedRm})`;
      } else {
        operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
        effect = `${rd} = ${rn} ${sub ? "-" : "+"} ${shiftedRm}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      break;
    }
    case "addsub_ext": {
      const sf = f.sf === 1;
      const sub = inst.name.startsWith("sub");
      const rn = register(at.rn, sf, true);
      const rmWide = (f.option & 0b011) === 0b011;
      const rm = register(at.rm, rmWide, false);
      const rd = register(at.rd, sf, true);
      push("rn", rn);
      push("rm", rm);
      push("rd", rd);
      const extendName = EXTEND_NAMES[f.option] || `extend<${f.option}>`;
      const amtOk = readable("imm3");
      const shiftSuffix = amtOk ? (f.imm3 ? `, ${extendName} #${f.imm3}` : `, ${extendName}`) : `, ${extendName} #<imm3>`;
      const extendedRm = amtOk ? `${extendName}(${rm})${f.imm3 ? ` << ${f.imm3}` : ""}` : `${extendName}(${rm}) << <imm3>`;
      if (readable("rd") && f.rd === 31) {
        mnemonic = sub ? "cmp" : "cmn";
        operands = `${rn}, ${rm}${shiftSuffix}`;
        effect = `flags = flagsOf(${rn} ${sub ? "-" : "+"} ${extendedRm})`;
      } else {
        operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
        effect = `${rd} = ${rn} ${sub ? "-" : "+"} ${extendedRm}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      break;
    }
    case "logical_reg": {
      const sf = f.sf === 1;
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      const rm = register(at.rm, sf, false);
      push("rn", rn);
      push("rm", rm);
      push("rd", rd);
      const amtOk = readable("imm6");
      const shiftType = SHIFT_NAMES_LOGICAL[f.shift];
      const shiftSuffix = amtOk ? (f.imm6 ? `, ${shiftType} #${f.imm6}` : "") : `, ${shiftType} #<imm6>`;
      const shiftedRm = amtOk ? (f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm) : `${shiftType}(${rm}, <imm6>)`;
      const notedRm = `${f.n ? "~" : ""}${shiftedRm}`;
      const op = { and: "&", bic: "&", orr: "|", orn: "|", eor: "^", eon: "^", ands: "&", bics: "&" }[inst.name];
      if (inst.name === "orr" && readable("rn") && f.rn === 31 && amtOk && !f.imm6) {
        mnemonic = "mov";
        operands = `${rd}, ${rm}`;
        effect = `${rd} = ${rm}`;
      } else if (inst.name === "orn" && readable("rn") && f.rn === 31) {
        mnemonic = "mvn";
        operands = `${rd}, ${rm}${shiftSuffix}`;
        effect = `${rd} = ~${shiftedRm}`;
      } else if ((inst.name === "ands" || inst.name === "bics") && readable("rd") && f.rd === 31) {
        mnemonic = "tst";
        operands = `${rn}, ${rm}${shiftSuffix}`;
        effect = `flags = flagsOf(${rn} & ${notedRm})`;
      } else {
        operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
        effect = `${rd} = ${rn} ${op} ${notedRm}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      break;
    }
    case "condselect": {
      const sf = f.sf === 1;
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      const rm = register(at.rm, sf, false);
      push("rn", rn);
      push("rm", rm);
      push("rd", rd);
      const condOk = readable("cond");
      const condText = condOk ? a.condName(f.cond) : unknown(at.cond);
      const invertedText = condOk && invertibleCond(f.cond) ? a.condName(a.invertCond(f.cond)) : null;
      const zeroZero = readable("rn") && readable("rm") && f.rn === 31 && f.rm === 31;
      const same = readable("rn") && readable("rm") && f.rn === f.rm;
      const canAlias = invertedText && (inst.name === "csinc" || inst.name === "csinv" || inst.name === "csneg");
      if (canAlias && zeroZero && inst.name !== "csneg") {
        mnemonic = inst.name === "csinc" ? "cset" : "csetm";
        operands = `${rd}, ${invertedText}`;
        effect = `${rd} = (${invertedText}) ? ${inst.name === "cset" ? "1" : "-1"} : 0`;
      } else if (canAlias && same) {
        mnemonic = { csinc: "cinc", csinv: "cinv", csneg: "cneg" }[inst.name];
        operands = `${rd}, ${rn}, ${invertedText}`;
        const op = { cinc: `${rn} + 1`, cinv: `~${rn}`, cneg: `-${rn}` }[mnemonic];
        effect = `${rd} = (${invertedText}) ? ${rn} : ${op}`;
      } else {
        operands = `${rd}, ${rn}, ${rm}, ${condText}`;
        const op2 = { csel: rm, csinc: `${rm} + 1`, csinv: `~${rm}`, csneg: `-${rm}` }[inst.name];
        effect = `${rd} = (${condText}) ? ${rn} : ${op2}`;
      }
      break;
    }
    case "condcompare": {
      const sf = f.sf === 1;
      const rn = register(at.rn, sf, false);
      push("rn", rn);
      const operand2 = readable("flag") && f.flag ? immText("rm_imm", (n) => `#${n}`) : register(at.rm_imm, sf, false);
      push(readable("flag") && f.flag ? "imm5" : "rm", operand2);
      const condText = readable("cond") ? a.condName(f.cond) : unknown(at.cond);
      const nzcvText = immText("nzcv", (n) => `#${n}`);
      operands = `${rn}, ${operand2}, ${nzcvText}, ${condText}`;
      effect = `flags = (${condText}) ? flagsOf(${rn} ${inst.name === "ccmp" ? "-" : "+"} ${operand2}) : ${nzcvText}`;
      break;
    }
    case "dp2src": {
      const sf = f.sf === 1;
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      const rm = register(at.rm, sf, false);
      push("rn", rn);
      push("rm", rm);
      push("rd", rd);
      operands = `${rd}, ${rn}, ${rm}`;
      effect = inst.desc.replace(/Rd/g, rd).replace(/Rn/g, rn).replace(/Rm/g, rm);
      break;
    }
    case "dp1src": {
      const sf = f.sf === 1;
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, sf, false);
      push("rn", rn);
      push("rd", rd);
      operands = `${rd}, ${rn}`;
      effect = inst.desc.replace(/Rd/g, rd).replace(/Rn/g, rn);
      break;
    }
    case "dp3src": {
      const sf = f.sf === 1;
      // See encode.js's matching comment: Rn/Rm stay W for the two
      // widening "long" op31 groups no matter how wide Rd/Ra (and the
      // 64 bit result) are.
      const narrowSrc = f.op31 === 0b001 || f.op31 === 0b101;
      const rd = register(at.rd, sf, false);
      const rn = register(at.rn, narrowSrc ? false : sf, false);
      const rm = register(at.rm, narrowSrc ? false : sf, false);
      const ra = register(at.ra, sf, false);
      push("rn", rn);
      push("rm", rm);
      push("ra", ra);
      push("rd", rd);
      const raZero = readable("ra") && f.ra === 31;
      if ((inst.name === "madd" || inst.name === "msub") && raZero) {
        mnemonic = inst.name === "madd" ? "mul" : "mneg";
        operands = `${rd}, ${rn}, ${rm}`;
        effect = inst.name === "madd" ? `${rd} = ${rn} * ${rm}` : `${rd} = -(${rn} * ${rm})`;
      } else if ((inst.name === "smaddl" || inst.name === "smsubl" || inst.name === "umaddl" || inst.name === "umsubl") && raZero) {
        mnemonic = { smaddl: "smull", smsubl: "smnegl", umaddl: "umull", umsubl: "umnegl" }[inst.name];
        operands = `${rd}, ${rn}, ${rm}`;
        effect = `${rd} = ${mnemonic.includes("neg") ? "-" : ""}(${inst.name[0]}Extend(${rn}) * ${inst.name[0]}Extend(${rm}))`;
      } else if (inst.name === "smulh" || inst.name === "umulh") {
        operands = `${rd}, ${rn}, ${rm}`;
        effect = inst.desc.replace(/Xd/g, rd).replace(/Xn/g, rn).replace(/Xm/g, rm);
      } else {
        operands = `${rd}, ${rn}, ${rm}, ${ra}`;
        effect = inst.desc.replace(/Rd|Xd/g, rd).replace(/Rn|Xn|Wn/g, rn).replace(/Rm|Xm|Wm/g, rm).replace(/Ra/g, ra);
      }
      break;
    }

    // --- Branches -------------------------------------------------------
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
      const rt = register(at.rt, f.sf === 1, false);
      push("rt", rt);
      const off = immText("imm19", (n) => `#${a.branchOffset(n, 19)}`);
      operands = `${rt}, ${off}`;
      effect = `if (${rt} ${inst.name === "cbz" ? "==" : "!="} 0) pc = pc + ${off}`;
      break;
    }
    case "tbz_tbnz": {
      const bitOk = readable("b5") && readable("b40");
      const bit = bitOk ? (f.b5 << 5) | f.b40 : null;
      const rt = register(at.rt, readable("b5") && f.b5 === 1, false);
      push("rt", rt);
      const off = immText("imm14", (n) => `#${a.branchOffset(n, 14)}`);
      const bitText = bitOk ? `#${bit}` : "needs b5 and b40 to be known";
      operands = `${rt}, ${bitText}, ${off}`;
      effect = `if (${rt}<${bitText}> ${inst.name === "tbz" ? "==" : "!="} 0) pc = pc + ${off}`;
      break;
    }
    case "br_reg": {
      const rn = register(at.rn, true, false);
      push("rn", rn);
      const bare = inst.name === "ret" && readable("rn") && f.rn === 30;
      operands = bare ? "" : rn;
      effect = inst.name === "blr" ? `x30 = pc + 4; pc = ${rn}` : `pc = ${rn}`;
      break;
    }

    // --- Loads and stores -------------------------------------------
    case "ldst_imm": {
      const rt = register(at.rt, inst.destWide, false);
      const rn = register(at.rn, true, true);
      push("rn", rn);
      push("rt", rt);
      const scale = 1 << f.size;
      const offOk = readable("imm12");
      const offset = offOk ? f.imm12 * scale : null;
      const addr = offOk ? (offset ? `[${rn}, #${offset}]` : `[${rn}]`) : `[${rn}, #<imm12 × ${scale}>]`;
      operands = `${rt}, ${addr}`;
      effect = inst.name.startsWith("st") ? `M[${rn} + ${offOk ? offset : "?"}] = ${rt}` : `${rt} = M[${rn} + ${offOk ? offset : "?"}]`;
      if (offOk && f.imm12 && scale > 1) extra.push({ label: "Offset", value: `imm12 (${f.imm12}) × ${scale} bytes = ${offset}` });
      break;
    }
    case "ldst_unscaled": {
      const rt = register(at.rt, inst.destWide, false);
      const rn = register(at.rn, true, true);
      push("rn", rn);
      push("rt", rt);
      const offOk = readable("imm9");
      const off = offOk ? a.signExtend(f.imm9, 9) : null;
      const offText = offOk ? `#${off}` : "<imm9>";
      const addr = f.idx === 0b00 ? (offOk && off ? `[${rn}, ${offText}]` : offOk ? `[${rn}]` : `[${rn}, ${offText}]`)
        : f.idx === 0b01 ? `[${rn}], ${offText}`
        : `[${rn}, ${offText}]!`;
      operands = `${rt}, ${addr}`;
      const mem = inst.name.startsWith("st") ? `M[${rn} + ${offOk ? off : "?"}] = ${rt}` : `${rt} = M[${rn} + ${offOk ? off : "?"}]`;
      effect = f.idx === 0b00 ? mem
        : f.idx === 0b01 ? `${mem}; ${rn} += ${offText}`
        : `${rn} += ${offText}; ${mem.replace(`${rn} + ${offOk ? off : "?"}`, rn)}`;
      break;
    }
    case "ldst_regoffset": {
      const rt = register(at.rt, inst.destWide, false);
      const rn = register(at.rn, true, true);
      const rmWide = (f.option & 0b011) === 0b011;
      const rm = register(at.rm, rmWide, false);
      push("rn", rn);
      push("rm", rm);
      push("rt", rt);
      const extendName = EXTEND_NAMES[f.option] || `extend<${f.option}>`;
      const sOk = readable("s");
      const shiftSuffix = sOk ? (f.s ? (f.size ? `, ${extendName} #${f.size}` : `, ${extendName} #0`) : (f.option === 0b011 ? "" : `, ${extendName}`)) : `, ${extendName} #<s>`;
      operands = `${rt}, [${rn}, ${rm}${shiftSuffix}]`;
      const addr = `${rn} + ${extendName}(${rm})${sOk && f.s ? ` << ${f.size}` : ""}`;
      effect = inst.name.startsWith("st") ? `M[${addr}] = ${rt}` : `${rt} = M[${addr}]`;
      break;
    }
    case "ldst_pair": {
      const rt = register(at.rt, inst.destWide, false);
      const rt2 = register(at.rt2, inst.destWide, false);
      const rn = register(at.rn, true, true);
      push("rn", rn);
      push("rt", rt);
      push("rt2", rt2);
      const scale = inst.destWide ? 8 : 4;
      const offOk = readable("imm7");
      const off = offOk ? a.signExtend(f.imm7, 7) * scale : null;
      const offText = offOk ? `#${off}` : "<imm7 × scale>";
      const addr = f.idx === 0b010 ? (offOk && off ? `[${rn}, ${offText}]` : offOk ? `[${rn}]` : `[${rn}, ${offText}]`)
        : f.idx === 0b001 ? `[${rn}], ${offText}`
        : `[${rn}, ${offText}]!`;
      operands = `${rt}, ${rt2}, ${addr}`;
      const size = inst.destWide ? 8 : 4;
      const base = offOk ? `${rn}+${off}` : `${rn}+?`;
      const mem = inst.name === "ldp" ? `${rt}, ${rt2} = M[${base}], M[${base}+${size}]` : `M[${base}], M[${base}+${size}] = ${rt}, ${rt2}`;
      effect = f.idx === 0b010 ? mem
        : f.idx === 0b001 ? `${mem}; ${rn} += ${offText}`
        : `${rn} += ${offText}; ${mem.replaceAll(base, rn)}`;
      break;
    }
    case "ldst_excl": {
      const wide = f.size === 0b11;
      const rt = register(at.rt, wide, false);
      const rn = register(at.rn, true, true);
      push("rn", rn);
      push("rt", rt);
      if (inst.name === "stxr" || inst.name === "stlxr") {
        const rs = register(at.rs, false, false);
        push("rs", rs);
        operands = `${rs}, ${rt}, [${rn}]`;
        effect = `M[${rn}] = ${rt}; ${rs} = 0 if that store succeeded`;
      } else if (inst.name === "ldxr" || inst.name === "ldaxr" || inst.name === "ldar") {
        operands = `${rt}, [${rn}]`;
        effect = `${rt} = M[${rn}]`;
      } else if (inst.name === "stlr") {
        operands = `${rt}, [${rn}]`;
        effect = `M[${rn}] = ${rt}`;
      } else {
        const rs = register(at.rs, wide, false);
        push("rs", rs);
        operands = `${rs}, ${rt}, [${rn}]`;
        effect = `if (M[${rn}] == ${rs}) M[${rn}] = ${rt}; ${rs} = old M[${rn}]`;
      }
      break;
    }
    case "ldst_literal": {
      const rt = register(at.rt, inst.destWide, false);
      push("rt", rt);
      const off = immText("imm19", (n) => `#${a.branchOffset(n, 19)}`);
      operands = `${rt}, ${off}`;
      effect = `${rt} = M[pc + ${off}]`;
      break;
    }

    // --- Atomics -----------------------------------------------------
    case "atomic_ldop": {
      const wide = f.size === 0b11;
      const rs = register(at.rs, wide, false);
      const rt = register(at.rt, wide, false);
      const rn = register(at.rn, true, true);
      push("rn", rn);
      push("rs", rs);
      push("rt", rt);
      operands = `${rs}, ${rt}, [${rn}]`;
      effect = inst.desc.replace(/Rs/g, rs).replace(/Rt/g, rt).replace(/Rn/g, rn);
      break;
    }

    // --- System ---------------------------------------------------------
    case "sysmisc": {
      operands = readable("crn") && f.crn === 0b0011 ? "sy" : ""; // this toolbox only names the full-system barrier domain
      effect = inst.desc;
      break;
    }
    case "excgen": {
      const immOk = readable("imm16");
      operands = immOk && f.imm16 ? `#${f.imm16}` : "#0";
      effect = inst.desc;
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
  const classBits = idx.toString(2).padStart(a.CLASS_SELECTOR_WIDTH, "0");
  return { class: classBits, ...a.wordFields(bits) };
}
