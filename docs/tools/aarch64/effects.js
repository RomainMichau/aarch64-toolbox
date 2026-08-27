// The Effect line's wording, shared by the encoder and the decoder.
//
// The two cards compute the same answer from opposite ends, and a reader
// moving a word between them should not have to notice: over 50,211 sampled
// decodable words the two used to word 15,103 of them differently — 14,743
// only in where a "#" sat, and 360 in how EXTR's window was named.

// An effect line is arithmetic, not assembler syntax: "x1 = x2 + #7" is not
// something anyone writes. The "#" belongs on the Instruction line above it
// and nowhere below, which is the rule the encoder already followed by hand
// in one case and the decoder followed nowhere.
export const noHash = (text) => text.replace(/#/g, "");

// extrWindow names the bit range EXTR takes out of the Rn:Rm pair. The
// encoder always knows the low bit and the decoder may not, so the range is
// named the same way either way rather than each card picking its own words.
export function extrWindow(rd, rn, rm, lsb, lsbText, datasize) {
  const known = lsb !== null;
  const low = known ? String(lsb) : lsbText;
  const high = known ? String(lsb + datasize - 1) : `${lsbText} + ${datasize - 1}`;
  return `${rd} = (${rn}:${rm}) bits [${high}:${low}]`;
}
