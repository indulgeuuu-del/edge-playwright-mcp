# Edge Playwright MCP

面向 Windows 的 Microsoft Edge 后台浏览器 MCP。基于固定版本的官方 Playwright MCP，提供最多 8 个并发独立配置档、持久化网站存储、租约恢复和安全的缓存清理。

默认创建空白配置档。显式启用后，可在 MCP 启动时同步日常 Edge 的资料快照；仓库不包含个人浏览器资料。本项目与 Microsoft/OpenAI 无隶属关系。

## 安装和使用

需要 Windows 10/11、PowerShell 5.1、Node.js 22/24 和 Microsoft Edge。

```powershell
git clone https://github.com/indulgeuuu-del/edge-playwright-mcp.git
cd edge-playwright-mcp
npm ci
npm test
npm run test:browser
```

MCP 客户端使用 `node` 加 `launch.mjs` 的绝对路径。Codex 配置示例和完整说明见 [英文 README](README.md)。安装不会改客户端配置，需要自行添加并重新加载 MCP。

| 设置 | 用途 |
| --- | --- |
| `EDGE_MCP_DATA_DIR` | 指定独立数据目录，默认 `%LOCALAPPDATA%/EdgePlaywrightMCP` |
| `EDGE_MCP_SYNC_MAIN=1` | 启用启动时资料同步，默认关闭 |
| `EDGE_MCP_MAIN_PROFILE` | 日常 Edge 的 User Data 源目录，默认包含 Default 的系统位置；不能与 MCP 数据目录重叠 |
| `EDGE_MCP_PROXY=http://127.0.0.1:端口` | 显式指定代理，不接受内嵌凭据 |
| `EDGE_MCP_PROXY=direct` | 强制浏览器直连，适合校园网模式 |

没有显式设置时，仅自动识别继承的 `127.0.0.1:18977` 专用代理；其他情况下浏览器可能遵循 Windows 系统代理。代理生命周期由外部启动器负责。

真实浏览器测试使用本机网站、临时空白数据目录，验证双客户端隔离、后台无窗口运行和关闭重开后的存储保留。不声称已验证任意网站、登录状态或未来浏览器版本。

配置档和输出包含私人数据，请勿提交 Git。卸载前关闭相关 MCP 与浏览器，再移除客户端注册和独立数据目录。缓存清理不等于硬性容量限制。

## 可选的日常 Edge 资料同步

在客户端环境设置 `EDGE_MCP_SYNC_MAIN=1`，并将 MCP 启动超时设为至少 180 秒。日常 Edge 完全关闭时才能抓取 Default 配置档；仍运行或进程无法核实时沿用上次安全快照，没有快照则保留空白配置档。这是启动时同步，不是持续镜像；需重载 MCP 才会重新执行。

同步包含偏好、书签、历史、Cookies、登录数据库、网站存储和扩展资料，不包括会话、磁盘缓存或锁文件。复制文件不保证登录状态或密码可解密；启用后 MCP 和扩展可能接触敏感资料，请使用私有数据目录。新快照覆盖所选槽位的受管数据，未改变的快照保留后台浏览器自己的改动。切换源目录请使用独立数据目录，并在日常 Edge 关闭后完成抓取。

同步使用独占文件锁、租约校验、哈希复核、事务回滚及 Windows Job Object。快照所选数据最多 1 GiB，保留一代旧快照和可能的中断暂存；不是整个数据目录的容量上限。不会添加常驻监听器。详细范围和限制见 [英文 README](README.md)。
