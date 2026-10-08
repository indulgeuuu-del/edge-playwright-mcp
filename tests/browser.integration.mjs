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

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('two real Edge clients isolate storage, stay headless, and reuse a persistent profile',
  { skip: process.platform !== 'win32', timeout: 180000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-mcp-public-'));
  const clients = [];
  const server = http.createServer((_, res) => { res.end('<!doctype html><title>MCP local fixture</title><h1>Ready</h1>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i.test(k)));
  async function open() {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'launch.mjs')],
      env: { ...env, EDGE_MCP_DATA_DIR: data, EDGE_MCP_PROXY: 'direct' }, stderr: 'pipe' });
    const client = new Client({ name: 'edge-mcp-public-test', version: '1.0' });
    clients.push(client);
    await client.connect(transport);
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
    const a = await open();
    const b = await open();
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
  }
});
