# Architecture and failure boundaries

`MCP client -> launch.mjs -> Windows profile lease -> pinned Playwright stdio CLI -> sandboxed headless Edge`.

The CLI stays in the launcher Node process. Pool operations serialize under a Windows FileShare.None lock. Lease ownership combines process ID, creation time and a random nonce. Stale leases are reusable only when no matching Node owner or Edge profile user can be observed. An unreadable lease fails closed.

Profiles start blank and are marked before browser creation. A pre-existing unmarked profile is preserved and refused. No private seed ships. Pool size is bounded; stored website data and output size are not. Cache pruning validates ownership and refuses reparse points under cache targets.

With EDGE_MCP_SYNC_MAIN=1, a short-lived PowerShell helper serializes snapshot capture with .seed.lock, skips source reads while non-pool Edge runs, and locks .pool.lock for inactive leased-slot application. Each Node worker waits for a stdin gate until assigned to a kill-on-close Job Object. The source remains read-only; data and snapshot directories live under EDGE_MCP_DATA_DIR, separately from source code.

Capture hashes selected files before/after staging and rechecks Edge state before publication. Publication keeps one previous generation. Slot journals distinguish preparing, prepared and committed states: unfinished application rolls back before reuse, while committed transactions resume cleanup. Unchanged revisions preserve slot changes; new revisions replace only selected roots, including deleted SQLite/LevelDB members. Unknown journals/paths fail closed. These mechanisms do not certify website logins or malicious local writers.

On ordinary process exit, the matching lease is removed. On forced termination, the OS releases helper locks and future launchers inspect stale leases. A browser still using a profile prevents reclamation; browser termination and instant cleanup are not guaranteed after every possible host crash.

The upstream core patch rejects individual internal-tab closure, including an internal tab later changed to about:blank. Input/output hashes and exact dependency versions guard patch application. Do not upgrade core without reviewing and testing a new patch.

The wrapper grants no additional filesystem security boundary beyond the MCP/browser tools. Run clients under an appropriate user account and keep their data directory private.
