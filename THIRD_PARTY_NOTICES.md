# Third-party notices

This repository does not vendor upstream source or Edge. npm installs @playwright/mcp 0.0.80 and its locked Playwright dependencies, licensed Apache-2.0. Microsoft Edge is distributed by Microsoft under its own terms. The MCP SDK used for tests is MIT licensed; see its installed license. Other transitive licenses remain in node_modules.

patch-core.mjs modifies the locally installed Apache-2.0 coreBundle.js with a hash-checked internal-tab-close guard. It preserves upstream distribution and license files. This modification is not endorsed by Microsoft and has not been submitted as an upstream fix. Dependency updates require review of the patch and lockfile, plus protocol/browser regression testing.
