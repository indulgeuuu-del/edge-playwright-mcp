import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
export async function inspectHeadless(ownerPid) {
  assert(Number.isInteger(ownerPid) && ownerPid > 0, 'MCP process PID must be available');
  const { stdout } = await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'inspect-headless.ps1'), String(ownerPid)
  ], { windowsHide: true, timeout: 15000, encoding: 'utf8' });
  return JSON.parse(stdout);
}
export function assertHeadless(state) {
  assert.equal(state.headless, true, 'Edge root must actually have --headless');
  assert(Array.isArray(state.visibleWindowPids), 'Window probe must return an array');
  assert.equal(state.visibleWindowPids.length, 0, 'Automation Edge must have no main window');
}
export async function verifyHeadless(ownerPid) {
  const state = await inspectHeadless(ownerPid);
  assertHeadless(state);
  return state;
}
