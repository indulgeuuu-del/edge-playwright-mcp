import path from 'node:path';
import os from 'node:os';

export function resolveSettings(env = process.env) {
  if (process.platform !== 'win32') throw new Error('This launcher supports Windows only.');
  const dataRoot = path.resolve(env.EDGE_MCP_DATA_DIR || path.join(env.LOCALAPPDATA || os.homedir(), 'EdgePlaywrightMCP'));
  const inherited = Object.entries(env).find(([key, value]) => /^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)$/i.test(key) && /^http:\/\/127\.0\.0\.1:18977\/?$/.test(value || ''))?.[1];
  const selection = env.EDGE_MCP_PROXY || inherited;
  let proxy;
  if (selection && selection !== 'direct') {
    const url = new URL(selection);
    if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw new Error('EDGE_MCP_PROXY must be a proxy origin without credentials, query or path, or direct.');
    }
    proxy = { server: `${url.protocol}//${url.host}`, bypass: 'localhost,127.0.0.1,[::1],*.localhost,*.local,*.lan' };
  }
  const launchOptions = { channel: 'msedge', headless: true, chromiumSandbox: true,
    args: ['--profile-directory=Default', ...(selection === 'direct' ? ['--no-proxy-server'] : [])] };
  if (proxy) launchOptions.proxy = proxy;
  if (env.EDGE_MCP_SYNC_MAIN && !['0', '1'].includes(env.EDGE_MCP_SYNC_MAIN)) throw new Error('EDGE_MCP_SYNC_MAIN must be 0 or 1.');
  const syncMain = env.EDGE_MCP_SYNC_MAIN === '1';
  const mainProfile = path.resolve(env.EDGE_MCP_MAIN_PROFILE || path.join(env.LOCALAPPDATA || os.homedir(), 'Microsoft', 'Edge', 'User Data'));
  if (syncMain) {
    const overlaps = (a, b) => a.toLowerCase() === b.toLowerCase() || a.toLowerCase().startsWith(b.toLowerCase() + path.sep);
    if (overlaps(mainProfile, dataRoot) || overlaps(dataRoot, mainProfile)) throw new Error('Main Edge source and MCP data must not overlap.');
  }
  return { dataRoot, launchOptions, syncMain, mainProfile };
}
