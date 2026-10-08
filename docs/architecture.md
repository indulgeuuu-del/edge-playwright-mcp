# Architecture and failure boundaries

`MCP client -> launch.mjs -> Windows profile lease -> pinned Playwright stdio CLI -> sandboxed headless Edge`.

The CLI stays in the launcher Node process. Pool operations serialize under a Windows FileShare.None lock. Lease ownership combines process ID, creation time and a random nonce. Stale leases are reusable only when no matching Node owner or Edge profile user can be observed. An unreadable lease fails closed.

Profiles start blank and are marked before browser creation. A pre-existing unmarked profile is preserved and refused. No private seed ships. Pool size is bounded; stored website data and output size are not. Cache pruning validates ownership and refuses reparse points under cache targets.

On ordinary process exit, the matching lease is removed. On forced termination, the OS releases helper locks and future launchers inspect stale leases. A browser still using a profile prevents reclamation; browser termination and instant cleanup are not guaranteed after every possible host crash.

The upstream core patch rejects individual internal-tab closure, including an internal tab later changed to about:blank. Input/output hashes and exact dependency versions guard patch application. Do not upgrade core without reviewing and testing a new patch.

The wrapper grants no additional filesystem security boundary beyond the MCP/browser tools. Run clients under an appropriate user account and keep their data directory private.
