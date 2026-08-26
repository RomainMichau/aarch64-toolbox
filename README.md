# AArch64 Toolbox

Browser helpers for AArch64 (A64): a number converter, and a reasonable core
of the instruction set as reference, encoder and decoder — data processing
(immediate: `ADD`/`SUB`/`AND`/`ORR`/`EOR`/`MOVZ`/`MOVN`/`MOVK`), data
processing (register: `ADD`/`SUB`/`AND`/`ORR`/`EOR` shifted-register forms),
branches (`B`/`BL`/`B.cond`/`CBZ`/`CBNZ`), and loads/stores (`LDR`/`STR`
immediate offset, at the byte/halfword/word/doubleword sizes).

**→ [romainmichau.github.io/aarch64-toolbox](https://romainmichau.github.io/aarch64-toolbox/)**

AArch64 has no single field that both shows in the word and picks the format,
the way RISC-V's opcode does — so the encoder adds one field of its own, a
class selector, that only exists in the UI and is never packed into the
32-bit word. Pick a class and the row of boxes changes into the format it
asks for.

Static site — no backend, no build. It is `docs/`, served as it sits.

Same shape as [RISC-V Toolbox](https://github.com/romainmichau/riscv_toolbox)
and [Turing Complete Toolbox](https://github.com/romainmichau/turing_complete_toolbox),
sibling toolboxes for other instruction sets.

```sh
npm run serve   # localhost:8080
npm test
```
