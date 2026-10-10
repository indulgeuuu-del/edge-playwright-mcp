# Edge Playwright MCP

[![CI](https://github.com/indulgeuuu-del/edge-playwright-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/indulgeuuu-del/edge-playwright-mcp/actions/workflows/ci.yml)

Run Microsoft's Playwright MCP in headless Microsoft Edge on Windows, with a bounded pool of eight independent persistent browser profiles. Designed for concurrent local MCP clients without sharing your everyday browser profile.

[简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Security](SECURITY.md)

## What you get

- Headless Edge with Chromium sandbox enabled; stdio transport, no HTTP or CDP listening server.
- Separate profiles for simultaneous clients; persistent website storage on slot reuse.
- Windows file-lock serialization, PID creation-time checks and stale-lease recovery.
- Ownership-checked pruning of disposable caches; cookies and site storage retained.
- Optional explicit proxy, direct mode, or automatic inheritance of the Codex dedicated `18977` proxy.
- Locked upstream dependencies and a reviewed, hash-checked internal-tab-close guard.

This is a community wrapper, not a Microsoft or OpenAI product. It supports Windows only. Profiles start blank by default. Explicit opt-in enables startup snapshots of selected everyday Edge data; no personal profile ships in this repository.

## Install

Requirements: Windows 10/11, Windows PowerShell 5.1, Node.js 22 or 24, and Microsoft Edge installed. Your PowerShell execution policy must permit the included local scripts; the launcher does not bypass organizational policy.

```powershell
git clone https://github.com/indulgeuuu-del/edge-playwright-mcp.git
cd edge-playwright-mcp
npm ci
npm test
```

`npm ci` applies a deterministic patch to the pinned Playwright core bundle. If versions or hashes do not match, installation fails instead of overwriting an unknown bundle. Review [third-party notices](THIRD_PARTY_NOTICES.md) before upgrading dependencies.

## Connect your MCP client

Set command to `node` and arguments to the **absolute** path of `launch.mjs`. For Codex, add to your existing configuration without replacing other settings:

```toml
[mcp_servers.edge_playwright]
command = "node"
args = ["C:/tools/edge-playwright-mcp/launch.mjs"]
```

For a JSON-based client, see [examples/mcp.json](examples/mcp.json). Restart or reload the MCP server after changing its environment; an already-running browser retains its startup settings.

## Configuration

| Environment variable | Default | Behavior |
| --- | --- | --- |
| `EDGE_MCP_DATA_DIR` | `%LOCALAPPDATA%/EdgePlaywrightMCP` | Private persistent pool and generated output location |
| `EDGE_MCP_SYNC_MAIN` | `0` | Set `1` to refresh/apply selected main Edge data at MCP startup |
| `EDGE_MCP_MAIN_PROFILE` | `%LOCALAPPDATA%/Microsoft/Edge/User Data` | Source User Data directory containing Local State and Default; must not overlap MCP data |
| `EDGE_MCP_PROXY` | unset | Explicit `http://`, `https://` or `socks5://` origin, without credentials |
| `EDGE_MCP_PROXY=direct` | opt-in | Adds `--no-proxy-server`, overriding dedicated and system proxy selection |

When unset, a case-insensitive inherited `HTTP_PROXY`, `HTTPS_PROXY` or `ALL_PROXY` selecting `http://127.0.0.1:18977` enables that browser proxy with local bypass. Other inherited proxy values are not promoted into an explicit browser proxy. Without an explicit proxy or direct setting, Edge may use Windows system proxy settings. Set `direct` when you require deterministic direct access.

The proxy is owned by your external launcher; this MCP does not start or restart it. Local bypass: localhost, IPv4/IPv6 loopback, `*.localhost`, `*.local`, and `*.lan`. Loopback is not an access-control boundary against other processes on the same machine.

## Optional main-profile snapshots

Set `EDGE_MCP_SYNC_MAIN=1` in the MCP client environment and allow a startup timeout of at least 180 seconds. Fully close everyday Edge to capture its Default profile. If any non-pool Edge root is running or unverifiable, capture is skipped and the last safe snapshot is used; without a prior snapshot the slot remains blank. This is startup synchronization, not continuous mirroring. A browser tab restart does not reload the MCP launcher.

An exclusive seed lock serializes capture/application. Source hashes and browser process state are rechecked before publication; the pool lock and lease identity protect application to an inactive slot. A changed snapshot replaces selected slot data, including deletion of obsolete managed files; an unchanged revision preserves background browser changes. Keep separate MCP data directories for different sources. Changing sources while Edge is running can retain the previous snapshot: close Edge and complete capture before using that new source.

Included data: Local State, preferences, bookmarks, history, favicons, cookies, login/Web Data databases with SQLite side files, Local Storage, IndexedDB and extension data. Sessions, disk caches and lock files are excluded. Copying cookies/password files does not guarantee decryption or login. Enabled extensions and trusted MCP clients may access sensitive data; review them before opting in. The source is read-only, and the automation browser always uses a leased copy.

The selected snapshot limit is 1 GiB. One previous generation and one interrupted staging generation may remain, plus slot rollback transactions; this is not a total disk quota. Atomic journals recover cancelled application before reuse. Windows Job Objects kill gated workers when their helper exits. Lock contention fails after a shared 90-second deadline; launcher timeout is 105 seconds. No watcher or resident sync service is added. See [architecture](docs/architecture.md).

## Verification

```powershell
npm test
npm run test:browser
npm audit
```

Unit tests cover proxy selection, dependency-patch failure paths, snapshot staging and interrupted transaction recovery, SQLite side files and Job Object worker termination. The real-browser tests use a local HTTP fixture and fresh temporary data directories in both blank and opt-in synthetic snapshot modes. They check concurrent headless Edge roots with no main windows, snapshot application, storage isolation, close/reopen and profile reuse. They do not test live logins, every site, extensions, or future Edge releases. CI runs both Node versions on Windows and installs Edge when needed.

## Operations and removal

Use `browser_close` to close the automation browser. Individual `edge://` and `chrome://` tab closure is rejected with guidance because the pinned upstream implementation can hang on these tabs.

At most eight simultaneous leases are allowed. Unverifiable leases and orphaned Edge processes block reuse; they are preserved for inspection. Close the owning MCP clients before removing their data. Website storage and generated output can grow; pruning is not a disk quota. To uninstall, remove the MCP registration and repository; optionally delete the dedicated data directory after all its browsers have exited. Ordinary Edge data is unaffected.

MIT license for wrapper code; Apache-2.0 upstream components remain separately licensed.
