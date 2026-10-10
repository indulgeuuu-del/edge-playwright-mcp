import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { validatePatch } from './patch-core.mjs';
import { resolveSettings } from './config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
validatePatch(root);
if (process.argv.length !== 2) throw new Error('Configure via EDGE_MCP_DATA_DIR and EDGE_MCP_PROXY; no CLI arguments are accepted.');
const { dataRoot, launchOptions, syncMain, mainProfile } = resolveSettings();
process.env.EDGE_MCP_DATA_DIR = dataRoot;
if (syncMain) process.env.EDGE_MCP_MAIN_PROFILE = mainProfile;
// The automation browser always uses a leased copy, never the everyday profile.
let ancestor = dataRoot;
while (true) {
  if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Data path must not contain a symlink or junction.');
  const parent = path.dirname(ancestor);
  if (parent === ancestor) break;
  ancestor = parent;
}
fs.mkdirSync(dataRoot, { recursive: true });
const pool = path.join(dataRoot, 'profiles', 'shared');
for (const candidate of [path.dirname(pool), pool]) {
  if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error('Pool must not contain a reparse point.');
}
const nonce = randomUUID();
const claim = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
  path.join(root, 'claim-profile.ps1'), String(process.pid), nonce],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (claim.error || claim.status !== 0) throw new Error(`Profile claim failed: ${claim.error?.message || claim.stderr.trim()}`);
const { slot } = JSON.parse(claim.stdout);
if (!/^slot-[0-7]$/.test(path.basename(slot)) || path.dirname(slot) !== pool) throw new Error('Invalid profile slot.');
const lease = path.join(slot, 'lease.json');
process.on('exit', () => {
  try {
    const current = JSON.parse(fs.readFileSync(lease, 'utf8'));
    if (current.pid === process.pid && current.nonce === nonce) fs.unlinkSync(lease);
  } catch {}
});
const profile = path.join(slot, 'profile');
const ready = path.join(slot, 'ready.json');
if (fs.existsSync(profile) && fs.lstatSync(profile).isSymbolicLink()) throw new Error('Profile must not be a reparse point.');
if (!fs.existsSync(ready)) {
  if (fs.existsSync(profile)) throw new Error('Unmarked profile preserved; inspect it before reuse.');
  // Marker precedes browser creation: a crash here cannot turn personal data into a seed.
  fs.writeFileSync(ready, JSON.stringify({ origin: 'blank-v1' }), { flag: 'wx' });
} else if (JSON.parse(fs.readFileSync(ready, 'utf8')).origin !== 'blank-v1') {
  throw new Error('Unrecognized profile marker.');
}
if (fs.existsSync(path.join(profile, 'Default'))) {
  const prune = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    path.join(root, 'prune-profile-cache.ps1'), String(process.pid), nonce, path.basename(slot)],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (prune.error || prune.status !== 0) throw new Error(`Cache ownership check failed: ${prune.error?.message || prune.stderr.trim()}`);
  const result = JSON.parse(prune.stdout);
  if (result.failed.length) process.stderr.write('Some disposable caches were retained.\n');
}
const outputDir = path.join(slot, 'output');
if (syncMain) {
  const sync = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    path.join(root, 'refresh-main-profile.ps1'), '-NodePath', process.execPath,
    '-SlotName', path.basename(slot), '-OwnerPid', String(process.pid), '-Nonce', nonce],
    { encoding: 'utf8', windowsHide: true, timeout: 105000, maxBuffer: 1024 * 1024 });
  if (sync.error || sync.status !== 0) throw new Error(`Main Edge sync failed: ${sync.error?.message || sync.stderr.trim()}`);
  const result = JSON.parse(sync.stdout);
  if (!['ready', 'main-edge-running'].includes(result.status)) throw new Error('Unexpected profile sync result.');
  fs.writeFileSync(path.join(slot, 'sync-status.json'), JSON.stringify(result, null, 2));
}
fs.mkdirSync(outputDir, { recursive: true });
const config = { browser: { browserName: 'chromium', isolated: false, userDataDir: profile,
  launchOptions, contextOptions: { viewport: { width: 1280, height: 900 } } },
  capabilities: ['core', 'vision', 'pdf'], timeouts: { action: 10000, navigation: 45000 }, outputDir };
const configPath = path.join(slot, 'launch.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const cli = path.join(root, 'node_modules', '@playwright', 'mcp', 'cli.js');
process.argv = [process.execPath, cli, '--config', configPath];
createRequire(import.meta.url)(cli);
