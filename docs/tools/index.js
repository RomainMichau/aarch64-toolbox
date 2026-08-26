// The toolbox: every tool that computes something, keyed by the id its
// descriptor carries in registry.js. A tool missing from here is pure
// reference documentation.

import { BASE_RUNNERS } from "./number.js";
import { encodeAarch64 } from "./encode.js";
import { decodeAarch64 } from "./decode.js";
import { makeRun } from "./run.js";

export const RUNNERS = {
  ...BASE_RUNNERS,
  "aarch64-encode": encodeAarch64,
  "aarch64-decode": decodeAarch64,
};

export const run = makeRun(RUNNERS);
