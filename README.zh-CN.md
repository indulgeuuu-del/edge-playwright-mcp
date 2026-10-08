# Edge Playwright MCP

面向 Windows 的 Microsoft Edge 后台浏览器 MCP。基于固定版本的官方 Playwright MCP，提供最多 8 个并发独立配置档、持久化网站存储、租约恢复和安全的缓存清理。

默认创建空白配置档，不复制日常浏览器的密码、Cookies、历史记录或扩展。本项目与 Microsoft/OpenAI 无隶属关系。

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
| `EDGE_MCP_PROXY=http://127.0.0.1:端口` | 显式指定代理，不接受内嵌凭据 |
| `EDGE_MCP_PROXY=direct` | 强制浏览器直连，适合校园网模式 |

没有显式设置时，仅自动识别继承的 `127.0.0.1:18977` 专用代理；其他情况下浏览器可能遵循 Windows 系统代理。代理生命周期由外部启动器负责。

真实浏览器测试使用本机网站、临时空白数据目录，验证双客户端隔离、后台无窗口运行和关闭重开后的存储保留。不声称已验证任意网站、登录状态或未来浏览器版本。

配置档和输出包含私人数据，请勿提交 Git。卸载前关闭相关 MCP 与浏览器，再移除客户端注册和独立数据目录。缓存清理不等于硬性容量限制。
