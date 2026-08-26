// The encoder: one box per field of the word, and the integer to feed the
// machine underneath. Unlike RISC-V, the box that picks the layout (`class`)
// is not itself part of the word — see aarch64.js's header comment — so it
// is read separately and left out of what packWord packs.
//
// Grouped the way aarch64/ itself is: data processing (immediate), data
// processing (register), branches, loads and stores, atomics, system.

import { bitsField, packWord, wordBits, hexWord } from "./bits.js";
import * as a from "./aarch64.js";
import { bitfieldAlias } from "./aarch64/dataproc-imm.js";

const SHIFT_NAMES_ADDSUB = ["lsl", "lsr", "asr", "reserved"];
const SHIFT_NAMES_LOGICAL = ["lsl", "lsr", "asr", "ror"];
const EXTEND_NAMES = ["uxtb", "uxth", "uxtw", "uxtx", "sxtb", "sxth", "sxtw", "sxtx"];

const imm = (n) => `#${n}`;
const hexImm = (n) => `#${a.hexNum(n)}`;

// invertibleCond is true for every condition but AL/NV (1110/1111) — the
// only ones CSET/CSETM/CINC/CINV/CNEG's "invert the condition" alias rule
// does not apply to, since "always" has no useful opposite.
const invertibleCond = (cond) => cond !== 0b1110 && cond !== 0b1111;

export function encodeAarch64(input) {
  const classIdx = bitsField(input, "class", a.CLASS_SELECTOR_WIDTH);
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

  const reg = (n, sf, sp) => a.regName(n, sf, sp);

  let mnemonic = inst.name;
  let operands = "";
  let effect = "";
  const extra = [];

  switch (cls) {
    // --- Data processing (immediate) ---------------------------------
    case "addsub_imm": {
      const sf = f.sf === 1;
      const sub = inst.name.startsWith("sub");
      const value = f.imm12 << (f.sh ? 12 : 0);
      const rn = reg(f.rn, sf, true);
      if (f.rd === 31) {
        mnemonic = sub ? "cmp" : "cmn";
        operands = `${rn}, ${imm(value)}`;
        effect = `flags = flagsOf(${rn} ${sub ? "-" : "+"} ${value})`;
      } else {
        const rd = reg(f.rd, sf, true);
        operands = `${rd}, ${rn}, ${imm(value)}`;
        effect = `${rd} = ${rn} ${sub ? "-" : "+"} ${value}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      if (f.sh) extra.push({ label: "Immediate", value: `imm12 (${f.imm12}) << 12 = ${value} — sh is set` });
      break;
    }
    case "logical_imm": {
      const sf = f.sf === 1;
      const datasize = sf ? 64 : 32;
      let value;
      try {
        value = a.decodeBitMasks(f.n, f.immr, f.imms, datasize);
      } catch (e) {
        fields.push({ label: "Instruction", value: `${mnemonic} ${reg(f.rd, sf, false)}, ${reg(f.rn, sf, false)}, <n/immr/imms>` });
        fields.push({ label: "Immediate", value: e.message });
        return fields;
      }
      const op = { and: "&", orr: "|", eor: "^", ands: "&" }[inst.name];
      const rn = reg(f.rn, sf, false);
      if (inst.name === "ands" && f.rd === 31) {
        mnemonic = "tst";
        operands = `${rn}, ${hexImm(value)}`;
        effect = `flags = flagsOf(${rn} & ${a.hexNum(value)})`;
      } else if (inst.name === "orr" && f.rn === 31) {
        mnemonic = "mov";
        const rd = reg(f.rd, sf, false);
        operands = `${rd}, ${hexImm(value)}`;
        effect = `${rd} = ${a.hexNum(value)}`;
      } else {
        const rd = reg(f.rd, sf, false);
        operands = `${rd}, ${rn}, ${hexImm(value)}`;
        effect = `${rd} = ${rn} ${op} ${a.hexNum(value)}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      break;
    }
    case "movewide": {
      const sf = f.sf === 1;
      const rd = reg(f.rd, sf, false);
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
    case "bitfield": {
      const sf = f.sf === 1;
      const rd = reg(f.rd, sf, false);
      const alias = bitfieldAlias(sf, f.opc, f.immr, f.imms);
      const rn = reg(f.rn, alias.narrowSrc ? false : sf, false);
      mnemonic = alias.name;
      if ("shift" in alias) {
        operands = `${rd}, ${rn}, ${imm(alias.shift)}`;
      } else if ("lsb" in alias) {
        operands = `${rd}, ${rn}, ${imm(alias.lsb)}, ${imm(alias.width)}`;
      } else {
        operands = `${rd}, ${rn}`;
      }
      effect = `${mnemonic} ${operands}`.replace(/#/g, "");
      extra.push({ label: "Fields", value: `N=${f.n}, immr=${f.immr}, imms=${f.imms}` });
      break;
    }
    case "extract": {
      const sf = f.sf === 1;
      const rd = reg(f.rd, sf, false);
      const rn = reg(f.rn, sf, false);
      const rm = reg(f.rm, sf, false);
      if (f.rm === f.rn) {
        mnemonic = "ror";
        operands = `${rd}, ${rn}, ${imm(f.lsb)}`;
        effect = `${rd} = ${rn} rotated right by ${f.lsb}`;
      } else {
        operands = `${rd}, ${rn}, ${rm}, ${imm(f.lsb)}`;
        effect = `${rd} = (${rn}:${rm}) bits [${f.lsb + (sf ? 63 : 31)}:${f.lsb}]`;
      }
      break;
    }
    case "pcrel": {
      const rd = reg(f.rd, true, false);
      const imm21 = a.signExtend((f.immhi << 2) | f.immlo, 21);
      operands = `${rd}, ${imm(inst.name === "adrp" ? imm21 * 4096 : imm21)}`;
      effect = inst.name === "adrp"
        ? `${rd} = (PC & ~0xFFF) + ${imm21 * 4096}`
        : `${rd} = PC + ${imm21}`;
      break;
    }

    // --- Data processing (register) -----------------------------------
    case "addsub_reg": {
      const sf = f.sf === 1;
      const sub = inst.name.startsWith("sub");
      const rn = reg(f.rn, sf, true);
      const rm = reg(f.rm, sf, false);
      const shiftType = SHIFT_NAMES_ADDSUB[f.shiftop >> 1];
      const shiftSuffix = f.imm6 ? `, ${shiftType} #${f.imm6}` : "";
      const shiftedRm = f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm;
      if (f.rd === 31) {
        mnemonic = sub ? "cmp" : "cmn";
        operands = `${rn}, ${rm}${shiftSuffix}`;
        effect = `flags = flagsOf(${rn} ${sub ? "-" : "+"} ${shiftedRm})`;
      } else {
        const rd = reg(f.rd, sf, true);
        operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
        effect = `${rd} = ${rn} ${sub ? "-" : "+"} ${shiftedRm}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      break;
    }
    case "addsub_ext": {
      const sf = f.sf === 1;
      const sub = inst.name.startsWith("sub");
      const rn = reg(f.rn, sf, true);
      const rmWide = (f.option & 0b011) === 0b011;
      const rm = reg(f.rm, rmWide, false);
      const extendName = EXTEND_NAMES[f.option];
      const shiftSuffix = f.imm3 ? `, ${extendName} #${f.imm3}` : `, ${extendName}`;
      const extendedRm = `${extendName}(${rm})${f.imm3 ? ` << ${f.imm3}` : ""}`;
      if (f.rd === 31) {
        mnemonic = sub ? "cmp" : "cmn";
        operands = `${rn}, ${rm}${shiftSuffix}`;
        effect = `flags = flagsOf(${rn} ${sub ? "-" : "+"} ${extendedRm})`;
      } else {
        const rd = reg(f.rd, sf, true);
        operands = `${rd}, ${rn}, ${rm}${shiftSuffix}`;
        effect = `${rd} = ${rn} ${sub ? "-" : "+"} ${extendedRm}${inst.name.endsWith("s") ? ", flags set" : ""}`;
      }
      break;
    }
    case "logical_reg": {
      const sf = f.sf === 1;
      const rd = reg(f.rd, sf, false);
      const rn = reg(f.rn, sf, false);
      const rm = reg(f.rm, sf, false);
      const shiftType = SHIFT_NAMES_LOGICAL[f.shift];
      const shiftSuffix = f.imm6 ? `, ${shiftType} #${f.imm6}` : "";
      const shiftedRm = f.imm6 ? `${shiftType}(${rm}, ${f.imm6})` : rm;
      const notedRm = f.n ? `~${shiftedRm}` : shiftedRm;
      const op = { and: "&", bic: "&", orr: "|", orn: "|", eor: "^", eon: "^", ands: "&", bics: "&" }[inst.name];
      if (inst.name === "orr" && f.rn === 31 && !f.imm6) {
        mnemonic = "mov";
        operands = `${rd}, ${rm}`;
        effect = `${rd} = ${rm}`;
      } else if (inst.name === "orn" && f.rn === 31) {
        mnemonic = "mvn";
        operands = `${rd}, ${rm}${shiftSuffix}`;
        effect = `${rd} = ~${shiftedRm}`;
      } else if ((inst.name === "ands" || inst.name === "bics") && f.rd === 31) {
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
      const rd = reg(f.rd, sf, false);
      const rn = reg(f.rn, sf, false);
      const rm = reg(f.rm, sf, false);
      const invertedCond = a.invertCond(f.cond);
      const zeroZero = f.rn === 31 && f.rm === 31;
      const same = f.rn === f.rm;
      const canAlias = (inst.name === "csinc" || inst.name === "csinv" || inst.name === "csneg") && invertibleCond(f.cond);
      if (canAlias && zeroZero && inst.name !== "csneg") {
        mnemonic = inst.name === "csinc" ? "cset" : "csetm";
        operands = `${rd}, ${a.condName(invertedCond)}`;
        effect = `${rd} = (${a.condName(invertedCond)}) ? ${inst.name === "cset" ? "1" : "-1"} : 0`;
      } else if (canAlias && same) {
        mnemonic = { csinc: "cinc", csinv: "cinv", csneg: "cneg" }[inst.name];
        operands = `${rd}, ${rn}, ${a.condName(invertedCond)}`;
        const op = { cinc: `${rn} + 1`, cinv: `~${rn}`, cneg: `-${rn}` }[mnemonic];
        effect = `${rd} = (${a.condName(invertedCond)}) ? ${rn} : ${op}`;
      } else {
        operands = `${rd}, ${rn}, ${rm}, ${a.condName(f.cond)}`;
        const op2 = { csel: rm, csinc: `${rm} + 1`, csinv: `~${rm}`, csneg: `-${rm}` }[inst.name];
        effect = `${rd} = (${a.condName(f.cond)}) ? ${rn} : ${op2}`;
      }
      break;
    }
    case "condcompare": {
      const sf = f.sf === 1;
      const rn = reg(f.rn, sf, false);
      const operand2 = f.flag ? `#${f.rm_imm}` : reg(f.rm_imm, sf, false);
      operands = `${rn}, ${operand2}, ${imm(f.nzcv)}, ${a.condName(f.cond)}`;
      effect = `flags = (${a.condName(f.cond)}) ? flagsOf(${rn} ${inst.name === "ccmp" ? "-" : "+"} ${operand2}) : ${f.nzcv}`;
      break;
    }
    case "dp2src": {
      const sf = f.sf === 1;
      const rd = reg(f.rd, sf, false);
      const rn = reg(f.rn, sf, false);
      const rm = reg(f.rm, sf, false);
      operands = `${rd}, ${rn}, ${rm}`;
      effect = inst.desc.replace(/Rd/g, rd).replace(/Rn/g, rn).replace(/Rm/g, rm);
      break;
    }
    case "dp1src": {
      const sf = f.sf === 1;
      const rd = reg(f.rd, sf, false);
      const rn = reg(f.rn, sf, false);
      operands = `${rd}, ${rn}`;
      effect = inst.desc.replace(/Rd/g, rd).replace(/Rn/g, rn);
      break;
    }
    case "dp3src": {
      const sf = f.sf === 1;
      // Rd/Ra always follow sf (sfOnly-tagged rows only ever match sf=1,
      // per find()'s guard). Rn/Rm follow sf too, except the two widening
      // "long" op31 groups (SMADDL/SMSUBL/UMADDL/UMSUBL and their SMULL/...
      // aliases), whose whole point is multiplying two 32 bit sources —
      // those stay W no matter how wide the 64 bit result is.
      const narrowSrc = f.op31 === 0b001 || f.op31 === 0b101;
      const rd = reg(f.rd, sf, false);
      const rn = reg(f.rn, narrowSrc ? false : sf, false);
      const rm = reg(f.rm, narrowSrc ? false : sf, false);
      if ((inst.name === "madd" || inst.name === "msub") && f.ra === 31) {
        mnemonic = inst.name === "madd" ? "mul" : "mneg";
        operands = `${rd}, ${rn}, ${rm}`;
        effect = inst.name === "madd" ? `${rd} = ${rn} * ${rm}` : `${rd} = -(${rn} * ${rm})`;
      } else if ((inst.name === "smaddl" || inst.name === "smsubl" || inst.name === "umaddl" || inst.name === "umsubl") && f.ra === 31) {
        mnemonic = { smaddl: "smull", smsubl: "smnegl", umaddl: "umull", umsubl: "umnegl" }[inst.name];
        operands = `${rd}, ${rn}, ${rm}`;
        effect = `${rd} = ${mnemonic.includes("neg") ? "-" : ""}(${inst.name[0]}Extend(${rn}) * ${inst.name[0]}Extend(${rm}))`;
      } else if (inst.name === "smulh" || inst.name === "umulh") {
        operands = `${rd}, ${rn}, ${rm}`;
        effect = inst.desc.replace(/Xd/g, rd).replace(/Xn/g, rn).replace(/Xm/g, rm);
      } else {
        const ra = reg(f.ra, sf, false);
        operands = `${rd}, ${rn}, ${rm}, ${ra}`;
        effect = inst.desc.replace(/Rd|Xd/g, rd).replace(/Rn|Xn|Wn/g, rn).replace(/Rm|Xm|Wm/g, rm).replace(/Ra/g, ra);
      }
      break;
    }

    // --- Branches -------------------------------------------------------
    case "b_bl": {
      const off = a.branchOffset(f.imm26, 26);
      operands = imm(off);
      effect = inst.name === "bl" ? `x30 = pc + 4; pc = pc + ${off}` : `pc = pc + ${off}`;
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
      const rt = reg(f.rt, f.sf === 1, false);
      operands = `${rt}, ${imm(off)}`;
      effect = `if (${rt} ${inst.name === "cbz" ? "==" : "!="} 0) pc = pc + ${off}`;
      break;
    }
    case "tbz_tbnz": {
      const bit = (f.b5 << 5) | f.b40;
      const rt = reg(f.rt, f.b5 === 1, false);
      const off = a.branchOffset(f.imm14, 14);
      operands = `${rt}, ${imm(bit)}, ${imm(off)}`;
      effect = `if (${rt}<${bit}> ${inst.name === "tbz" ? "==" : "!="} 0) pc = pc + ${off}`;
      break;
    }
    case "br_reg": {
      const rn = reg(f.rn, true, false);
      // ret defaults to x30 in the assembler; a disassembler shows the
      // register only when it differs from that default.
      operands = inst.name === "ret" && f.rn === 30 ? "" : rn;
      effect = inst.name === "blr" ? `x30 = pc + 4; pc = ${rn}` : `pc = ${rn}`;
      break;
    }

    // --- Loads and stores -------------------------------------------
    case "ldst_imm": {
      const rt = reg(f.rt, inst.destWide, false);
      const rn = reg(f.rn, true, true);
      const scale = 1 << f.size;
      const offset = f.imm12 * scale;
      const addr = offset ? `[${rn}, ${imm(offset)}]` : `[${rn}]`;
      operands = `${rt}, ${addr}`;
      effect = inst.name.startsWith("st") ? `M[${rn} + ${offset}] = ${rt}` : `${rt} = M[${rn} + ${offset}]`;
      if (f.imm12 && scale > 1) extra.push({ label: "Offset", value: `imm12 (${f.imm12}) × ${scale} bytes = ${offset}` });
      break;
    }
    case "ldst_unscaled": {
      const rt = reg(f.rt, inst.destWide, false);
      const rn = reg(f.rn, true, true);
      const off = a.signExtend(f.imm9, 9);
      const addr = f.idx === 0b00 ? (off ? `[${rn}, ${imm(off)}]` : `[${rn}]`)
        : f.idx === 0b01 ? `[${rn}], ${imm(off)}`
        : `[${rn}, ${imm(off)}]!`;
      operands = `${rt}, ${addr}`;
      const mem = inst.name.startsWith("st") ? `M[${rn} + ${off}] = ${rt}` : `${rt} = M[${rn} + ${off}]`;
      effect = f.idx === 0b00 ? mem
        : f.idx === 0b01 ? `${mem}; ${rn} += ${off}`
        : `${rn} += ${off}; ${mem.replace(`${rn} + ${off}`, rn)}`;
      break;
    }
    case "ldst_regoffset": {
      const rt = reg(f.rt, inst.destWide, false);
      const rn = reg(f.rn, true, true);
      const rmWide = (f.option & 0b011) === 0b011;
      const rm = reg(f.rm, rmWide, false);
      const extendName = EXTEND_NAMES[f.option];
      const scaleBits = f.size;
      const shiftSuffix = f.s ? (scaleBits ? `, ${extendName} #${scaleBits}` : `, ${extendName} #0`) : (f.option === 0b011 ? "" : `, ${extendName}`);
      operands = `${rt}, [${rn}, ${rm}${shiftSuffix}]`;
      const addr = `${rn} + ${extendName}(${rm})${f.s ? ` << ${scaleBits}` : ""}`;
      effect = inst.name.startsWith("st") ? `M[${addr}] = ${rt}` : `${rt} = M[${addr}]`;
      break;
    }
    case "ldst_pair": {
      const rt = reg(f.rt, inst.destWide, false);
      const rt2 = reg(f.rt2, inst.destWide, false);
      const rn = reg(f.rn, true, true);
      const scale = inst.destWide ? 8 : 4;
      const off = a.signExtend(f.imm7, 7) * scale;
      const addr = f.idx === 0b010 ? (off ? `[${rn}, ${imm(off)}]` : `[${rn}]`)
        : f.idx === 0b001 ? `[${rn}], ${imm(off)}`
        : `[${rn}, ${imm(off)}]!`;
      operands = `${rt}, ${rt2}, ${addr}`;
      const size = inst.destWide ? 8 : 4;
      const mem = inst.name === "ldp" ? `${rt}, ${rt2} = M[${rn}+${off}], M[${rn}+${off}+${size}]` : `M[${rn}+${off}], M[${rn}+${off}+${size}] = ${rt}, ${rt2}`;
      effect = f.idx === 0b010 ? mem
        : f.idx === 0b001 ? `${mem}; ${rn} += ${off}`
        : `${rn} += ${off}; ${mem.replace(new RegExp(`${rn}\\+${off}`, "g"), rn)}`;
      break;
    }
    case "ldst_excl": {
      const wide = f.size === 0b11;
      const rt = reg(f.rt, wide, false);
      const rn = reg(f.rn, true, true);
      if (inst.name === "stxr" || inst.name === "stlxr") {
        const rs = reg(f.rs, false, false);
        operands = `${rs}, ${rt}, [${rn}]`;
        effect = `M[${rn}] = ${rt}; ${rs} = 0 if that store succeeded`;
      } else if (inst.name === "ldxr" || inst.name === "ldaxr" || inst.name === "ldar") {
        operands = `${rt}, [${rn}]`;
        effect = `${rt} = M[${rn}]`;
      } else if (inst.name === "stlr") {
        operands = `${rt}, [${rn}]`;
        effect = `M[${rn}] = ${rt}`;
      } else {
        // cas/casa/casl/casal — Rs holds the expected value in, the old value out.
        const rs = reg(f.rs, wide, false);
        operands = `${rs}, ${rt}, [${rn}]`;
        effect = `if (M[${rn}] == ${rs}) M[${rn}] = ${rt}; ${rs} = old M[${rn}]`;
      }
      break;
    }
    case "ldst_literal": {
      const rt = reg(f.rt, inst.destWide, false);
      const off = a.branchOffset(f.imm19, 19);
      operands = `${rt}, ${imm(off)}`;
      effect = `${rt} = M[pc + ${off}]`;
      break;
    }

    // --- Atomics -----------------------------------------------------
    case "atomic_ldop": {
      const wide = f.size === 0b11;
      const rs = reg(f.rs, wide, false);
      const rt = reg(f.rt, wide, false);
      const rn = reg(f.rn, true, true);
      operands = `${rs}, ${rt}, [${rn}]`;
      effect = inst.desc.replace(/Rs/g, rs).replace(/Rt/g, rt).replace(/Rn/g, rn);
      break;
    }

    // --- System ---------------------------------------------------------
    case "sysmisc": {
      operands = f.crn === 0b0011 ? "sy" : ""; // this toolbox only names the full-system barrier domain
      effect = inst.desc;
      break;
    }
    case "excgen": {
      operands = f.imm16 ? imm(f.imm16) : "#0";
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
