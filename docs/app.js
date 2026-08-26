// AArch64 Toolbox: a static page, computing everything in the browser.
// The tool descriptors come from registry.js and the answers from tools/.

import { mount } from "./lib/bootstrap.js";
import { TOOLS } from "./registry.js";

mount(TOOLS);
