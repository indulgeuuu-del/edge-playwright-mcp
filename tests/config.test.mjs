import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSettings } from '../config.mjs';

test('main profile synchronization is opt-in and rejects overlapping directories', { skip: process.platform !== 'win32' }, () => {
  assert.equal(resolveSettings({}).syncMain, false);
  assert.equal(resolveSettings({ EDGE_MCP_SYNC_MAIN: '1' }).syncMain, true);
  assert.throws(() => resolveSettings({ EDGE_MCP_SYNC_MAIN: 'yes' }), /0 or 1/);
  for (const source of ['C:/fixture', 'C:/fixture/data', 'C:/fixture/data/source']) {
    assert.throws(() => resolveSettings({ EDGE_MCP_SYNC_MAIN: '1', EDGE_MCP_DATA_DIR: 'C:/fixture/data', EDGE_MCP_MAIN_PROFILE: source }), /overlap/);
  }
});

test('settings are Windows-only and keep browser sandbox/headless enabled', () => {
  if (process.platform !== 'win32') { assert.throws(() => resolveSettings({}), /Windows only/); return; }
  const { launchOptions } = resolveSettings({});
  assert.equal(launchOptions.headless, true);
  assert.equal(launchOptions.chromiumSandbox, true);
  assert.equal(launchOptions.proxy, undefined);
});
test('explicit direct mode overrides inherited dedicated proxy', { skip: process.platform !== 'win32' }, () => {
  const { launchOptions } = resolveSettings({ EDGE_MCP_PROXY: 'direct', HTTPS_PROXY: 'http://127.0.0.1:18977' });
  assert.equal(launchOptions.proxy, undefined);
  assert(launchOptions.args.includes('--no-proxy-server'));
});
test('dedicated proxy inheritance is case insensitive; unrelated proxy is not promoted', { skip: process.platform !== 'win32' }, () => {
  assert.equal(resolveSettings({ https_proxy: 'http://127.0.0.1:18977' }).launchOptions.proxy.server, 'http://127.0.0.1:18977');
  assert.equal(resolveSettings({ HTTPS_PROXY: 'http://127.0.0.1:9999' }).launchOptions.proxy, undefined);
});
test('reject proxy credentials and unsupported URL schemes', { skip: process.platform !== 'win32' }, () => {
  for (const proxy of ['http://user:secret@localhost:8080', 'file:///etc', 'http://localhost:8080/path']) {
    assert.throws(() => resolveSettings({ EDGE_MCP_PROXY: proxy }));
  }
});
test('SOCKS origin retains its scheme instead of URL.origin null', { skip: process.platform !== 'win32' }, () => {
  assert.equal(resolveSettings({ EDGE_MCP_PROXY: 'socks5://127.0.0.1:1080' }).launchOptions.proxy.server, 'socks5://127.0.0.1:1080');
});
