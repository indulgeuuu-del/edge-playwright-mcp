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

This is a community wrapper, not a Microsoft or OpenAI product. It supports Windows only. It does not import bookmarks, extensions, cookies or passwords from your normal Edge browser.

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
| `EDGE_MCP_PROXY` | unset | Explicit `http://`, `https://` or `socks5://` origin, without credentials |
| `EDGE_MCP_PROXY=direct` | opt-in | Adds `--no-proxy-server`, overriding dedicated and system proxy selection |

When unset, a case-insensitive inherited `HTTP_PROXY`, `HTTPS_PROXY` or `ALL_PROXY` selecting `http://127.0.0.1:18977` enables that browser proxy with local bypass. Other inherited proxy values are not promoted into an explicit browser proxy. Without an explicit proxy or direct setting, Edge may use Windows system proxy settings. Set `direct` when you require deterministic direct access.

The proxy is owned by your external launcher; this MCP does not start or restart it. Local bypass: localhost, IPv4/IPv6 loopback, `*.localhost`, `*.local`, and `*.lan`. Loopback is not an access-control boundary against other processes on the same machine.

## Verification

```powershell
npm test
npm run test:browser
npm audit
```

Unit tests cover proxy selection and dependency-patch failure paths. The real-browser test uses a local HTTP fixture and a fresh temporary data directory, checks two concurrent headless Edge roots with no main windows, storage isolation, close/reopen and profile reuse. It does not test live logins, every site, extensions, or future Edge releases. CI runs both Node versions on Windows and installs Edge when needed.

## Operations and removal

Use `browser_close` to close the automation browser. Individual `edge://` and `chrome://` tab closure is rejected with guidance because the pinned upstream implementation can hang on these tabs.

At most eight simultaneous leases are allowed. Unverifiable leases and orphaned Edge processes block reuse; they are preserved for inspection. Close the owning MCP clients before removing their data. Website storage and generated output can grow; pruning is not a disk quota. To uninstall, remove the MCP registration and repository; optionally delete the dedicated data directory after all its browsers have exited. Ordinary Edge data is unaffected.

MIT license for wrapper code; Apache-2.0 upstream components remain separately licensed.
