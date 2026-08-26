# AArch64 Toolbox

Browser helpers for AArch64 (A64): a number converter, and the integer core
and atomics a modern CPU needs for general-purpose, non-numeric code, as
reference, encoder and decoder — 28 instruction classes, 244 named forms.
Data processing (immediate and register): `ADD`/`SUB`/`AND`/`ORR`/`EOR` and
their `S`-setting/`BIC`/`ORN`/`EON` siblings, `MOVZ`/`MOVN`/`MOVK`, bitfield
move and its aliases (`SXTB`/`SXTH`/`SXTW`, `LSL`/`LSR`/`ASR`,
`BFI`/`BFXIL`, `SBFIZ`/`SBFX`/`UBFIZ`/`UBFX`), `EXTR`/`ROR`, `ADR`/`ADRP`,
extended-register add/sub, conditional select/compare
(`CSEL`/`CSINC`/`CSINV`/`CSNEG` and `CSET`/`CINC`/.../`CCMP`/`CCMN`),
`SDIV`/`UDIV`, register shifts, `RBIT`/`REV`/`CLZ`/`CLS`, and
`MADD`/`MSUB`/`MUL`/the widening and high multiplies. Branches: `B`/`BL`/
`B.cond`/`CBZ`/`CBNZ`/`TBZ`/`TBNZ`/`BR`/`BLR`/`RET`. Loads/stores: unsigned
and unscaled immediate offset, pre/post-indexed, register offset, pairs,
exclusive/ordered access, `CAS`, and PC-relative literal loads, at every
size including the signed loads. Barriers, `NOP`-family hints, `SVC`/`BRK`/
`HLT`, and the LSE atomics (`LDADD`/`LDCLR`/`LDEOR`/`LDSET`/.../`SWP`).
Floating point, SIMD/NEON, SVE, and system-register access (`MRS`/`MSR`)
are out of scope.

**→ [romainmichau.github.io/aarch64-toolbox](https://romainmichau.github.io/aarch64-toolbox/)**

AArch64 has no single field that both shows in the word and picks the format,
the way RISC-V's opcode does — so the encoder adds one field of its own, a
class selector, that only exists in the UI and is never packed into the
32-bit word. Pick a class and the row of boxes changes into the format it
asks for.

Type an instruction name into the encoder and the class and opcode boxes fill
themselves in, leaving the operands to type; the reference card has a filter
box over all 244 forms; and every card puts what it is showing in the address
bar, so a decoded word is a link you can send someone.

Static site — no backend, no build. It is `docs/`, served as it sits.

Same shape as [RISC-V Toolbox](https://github.com/romainmichau/riscv_toolbox)
and [Turing Complete Toolbox](https://github.com/romainmichau/turing_complete_toolbox),
sibling toolboxes for other instruction sets.

```sh
npm run serve   # localhost:8080
npm test
```
