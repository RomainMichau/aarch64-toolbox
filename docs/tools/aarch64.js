// The AArch64 tables and machinery live under aarch64/, split by family
// (data-processing immediate/register, branch, load/store, atomics,
// system) since one file covering the whole toolbox's scope stopped being
// readable. This barrel keeps every other file's `import * as a from
// "./aarch64.js"` working unchanged — see aarch64/index.js for the actual
// merge and the classify/find machinery.
export * from "./aarch64/index.js";
