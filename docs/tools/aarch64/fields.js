// Shared helpers every class module needs: register naming, condition codes,
// the sign/branch-offset math, and the bitmask-immediate algorithm. None of
// this is specific to one instruction class, so it does not live with any of
// them.

export const WORD_BITS = 32;

// regName spells a register field out. sp=true means 31 reads as the stack
// pointer (the add/sub-family's Rn/Rd, and the load/store base register);
// everywhere else 31 is the zero register.
export function regName(n, sf, sp) {
  const width = sf ? "x" : "w";
  if (n === 31) return sp ? "sp" : (sf ? "xzr" : "wzr");
  return `${width}${n}`;
}

export const CONDITIONS = [
  ["eq", "Z == 1", "equal"],
  ["ne", "Z == 0", "not equal"],
  ["cs", "C == 1", "carry set / unsigned higher or same"],
  ["cc", "C == 0", "carry clear / unsigned lower"],
  ["mi", "N == 1", "negative"],
  ["pl", "N == 0", "positive or zero"],
  ["vs", "V == 1", "signed overflow"],
  ["vc", "V == 0", "no signed overflow"],
  ["hi", "C == 1 && Z == 0", "unsigned higher"],
  ["ls", "!(C == 1 && Z == 0)", "unsigned lower or same"],
  ["ge", "N == V", "signed greater or equal"],
  ["lt", "N != V", "signed less than"],
  ["gt", "Z == 0 && N == V", "signed greater than"],
  ["le", "!(Z == 0 && N == V)", "signed less or equal"],
  ["al", "true", "always"],
  ["nv", "true", "always (reserved encoding)"],
];

export const condName = (n) => CONDITIONS[n]?.[0] || `cond${n}`;

// invertCond flips a condition's least significant bit — AArch64's own
// trick for "the opposite test", used by CSINC/CSINV/CSNEG's aliases and by
// CCMP/CCMN's flags-on-fail encoding of the *true* branch's condition.
export const invertCond = (n) => n ^ 1;

// signExtend reads a width-bit two's complement field as a signed number.
export function signExtend(value, width) {
  const sign = 1 << (width - 1);
  return (value & (sign - 1)) - (value & sign);
}

// branchOffset is the byte offset a branch's word-aligned immediate stands
// for: the field counts words, not bytes, so the reach is 4x the bit count.
export function branchOffset(imm, width) {
  return signExtend(imm, width) * 4;
}

// decodeBitMasks turns AArch64's N:immr:imms bitmask-immediate encoding into
// the actual value AND/ORR/EOR (immediate) operate with — the same algorithm
// the architecture's own pseudocode (DecodeBitMasks) uses: find the smallest
// repeating element these three fields describe, build a run of ones the
// width imms picks, rotate it by immr, then tile it across the register.
// Returns a BigInt, since a 64 bit pattern does not fit in a JS number, or
// throws when N/immr/imms do not encode a valid bitmask (the architecture
// reserves several combinations, notably an all-ones element).
export function decodeBitMasks(n, immr, imms, datasize) {
  const combined = (n << 6) | (~imms & 0x3f);
  // Highest set bit of the 7 bit value above (Math.clz32 counts leading
  // zeros over a 32 bit word, so undo that offset); -1 when combined is 0.
  const hi = 31 - Math.clz32(combined);
  if (hi < 1) throw new Error("N:immr:imms is a reserved bitmask immediate (no element size fits)");
  const e = 1 << hi; // element size
  if (e > datasize) throw new Error(`N:immr:imms asks for a ${e} bit element, too wide for a ${datasize} bit register`);
  const levels = e - 1;
  const s = imms & levels;
  const r = immr & levels;
  if (s === levels) throw new Error("N:immr:imms is reserved (an all-ones element would be a no-op mask)");

  const ones = (1n << BigInt(s + 1)) - 1n; // s+1 ones, at the bottom of an e bit field
  const eMask = (1n << BigInt(e)) - 1n;
  const rotated = r === 0 ? ones : ((ones >> BigInt(r)) | (ones << BigInt(e - r))) & eMask;

  let wmask = 0n;
  for (let i = 0; i < datasize; i += e) wmask |= rotated << BigInt(i);
  return wmask & ((1n << BigInt(datasize)) - 1n);
}

// hexNum formats a plain number or BigInt the same way, since
// decodeBitMasks hands back a BigInt but most other fields are plain numbers.
export const hexNum = (n) => "0x" + n.toString(16).toUpperCase();
