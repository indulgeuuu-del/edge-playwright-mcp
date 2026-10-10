import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { verifyHeadless } from '../verify-process.mjs';
import { stage, publish } from '../sync-profile.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const syncMain of [false, true]) test(`two real Edge clients isolate storage, stay headless, and reuse a profile (sync=${syncMain})`,
  { skip: process.platform !== 'win32', timeout: 180000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-mcp-public-'));
  const source = `${data}-source`;
  if (syncMain) {
    fs.mkdirSync(path.join(source, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(source, 'Local State'), '{}');
    fs.writeFileSync(path.join(source, 'Default', 'Preferences'), '{}');
    stage(source, path.join(data, 'profile-seed-live'));
    publish(path.join(data, 'profile-seed-live'));
  }
  const clients = [];
  const server = http.createServer((_, res) => { res.end('<!doctype html><title>MCP local fixture</title><h1>Ready</h1>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i.test(k)));
  async function open() {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'launch.mjs')],
      env: { ...env, EDGE_MCP_DATA_DIR: data, EDGE_MCP_PROXY: 'direct', EDGE_MCP_SYNC_MAIN: syncMain ? '1' : '0', EDGE_MCP_MAIN_PROFILE: source }, stderr: 'pipe' });
    const client = new Client({ name: 'edge-mcp-public-test', version: '1.0' });
    clients.push(client);
    await client.connect(transport, { timeout: 180000 });
    if (syncMain) {
      const pool = path.join(data, 'profiles/shared');
      const slot = fs.readdirSync(pool).find(name => {
        try { return JSON.parse(fs.readFileSync(path.join(pool, name, 'lease.json'), 'utf8')).pid === transport.pid; } catch { return false; }
      });
      assert(slot);
      const result = JSON.parse(fs.readFileSync(path.join(pool, slot, 'sync-status.json'), 'utf8'));
      assert(result.applied?.revision, 'Every claimant must apply or confirm the snapshot');
    }
    await call(client, 'browser_navigate', { url });
    await verifyHeadless(transport.pid);
    return client;
  }
  async function call(client, name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result));
    return result;
  }
  try {
    const [a, b] = await Promise.all([open(), open()]);
    await call(a, 'browser_evaluate', { function: "() => localStorage.setItem('isolated', 'A')" });
    const other = await call(b, 'browser_evaluate', { function: "() => localStorage.getItem('isolated')" });
    assert(!JSON.stringify(other).includes('"A"'));
    await call(a, 'browser_close', {});
    await a.close(); clients.splice(clients.indexOf(a), 1);
    const c = await open();
    const retained = await call(c, 'browser_evaluate', { function: "() => localStorage.getItem('isolated')" });
    assert.match(JSON.stringify(retained), /A/);
    for (const client of [...clients]) { await call(client, 'browser_close', {}); await client.close(); }
    clients.length = 0;
    const slots = fs.readdirSync(path.join(data, 'profiles/shared')).filter(n => n.startsWith('slot-'));
    assert(slots.length <= 8);
  } finally {
    for (const client of clients) { try { await client.callTool({ name: 'browser_close', arguments: {} }); } catch {} await client.close(); }
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(data), path.resolve(os.tmpdir()));
    fs.rmSync(data, { recursive: true });
    if (fs.existsSync(source)) fs.rmSync(source, { recursive: true });
  }
});
