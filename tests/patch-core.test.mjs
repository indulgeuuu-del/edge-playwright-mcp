import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyPatch, validatePatch, originalHash, patchedHash } from '../patch-core.mjs';
import { assertHeadless } from '../verify-process.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const installed = fs.readFileSync(path.join(root, 'node_modules/playwright-core/lib/coreBundle.js'), 'utf8');
const original = installed.replace(/        const url3 = tab2\.page\.url\(\);\n[\s\S]*?        return url3;/,
  '        const url3 = tab2.page.url();\n        await tab2.page.close();\n        return url3;');
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(original), originalHash, 'Fixture must reconstruct the exact locked official bundle');

function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(parent, 'edge-mcp-patch-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), parent);
    assert(path.basename(dir).startsWith('edge-mcp-patch-test-'));
    fs.rmSync(dir, { recursive: true });
  });
  const core = path.join(dir, 'node_modules/playwright-core');
  const mcp = path.join(dir, 'node_modules/@playwright/mcp');
  fs.mkdirSync(path.join(core, 'lib'), { recursive: true });
  fs.mkdirSync(mcp, { recursive: true });
  fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ version: '1.63.0-alpha-2026-08-31' }));
  fs.writeFileSync(path.join(mcp, 'package.json'), JSON.stringify({ version: '0.0.80' }));
  const file = path.join(core, 'lib/coreBundle.js');
  fs.writeFileSync(file, original);
  return { dir, file, core };
}

test('official bundle becomes the exact reviewed bundle; reapplying is idempotent', t => {
  const { dir, file } = fixture(t);
  assert.equal(applyPatch(dir), 'patched');
  assert.equal(hash(fs.readFileSync(file)), patchedHash);
  assert.equal(applyPatch(dir), 'already-patched');
  validatePatch(dir);
});
test('startup validation rejects unpatched dependencies', t => {
  const { dir } = fixture(t);
  assert.throws(() => validatePatch(dir), /absent or modified/);
});
test('unknown local changes are preserved', t => {
  const { dir, file } = fixture(t);
  fs.appendFileSync(file, '\n// unrelated local change\n');
  const before = fs.readFileSync(file);
  assert.throws(() => applyPatch(dir), /refusing to overwrite/);
  assert.deepEqual(fs.readFileSync(file), before);
});
test('dependency upgrades are rejected before writing', t => {
  const { dir, file, core } = fixture(t);
  fs.writeFileSync(path.join(core, 'package.json'), '{"version":"99.0.0"}');
  assert.throws(() => applyPatch(dir), /Unsupported/);
  assert.equal(hash(fs.readFileSync(file)), originalHash);
});
test('launcher fails before creating profile pool on missing patch', t => {
  const { dir } = fixture(t);
  for (const name of ['launch.mjs', 'patch-core.mjs', 'config.mjs']) fs.copyFileSync(path.join(root, name), path.join(dir, name));
  const result = spawnSync(process.execPath, [path.join(dir, 'launch.mjs')], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /absent or modified/);
  assert.equal(fs.existsSync(path.join(dir, 'profiles')), false);
});
test('headed Edge and visible windows cannot pass background acceptance', () => {
  assert.throws(() => assertHeadless({ headless: false, visibleWindowPids: [] }), /--headless/);
  assert.throws(() => assertHeadless({ headless: true, visibleWindowPids: [123] }), /no main window/);
  assertHeadless({ headless: true, visibleWindowPids: [] });
});
