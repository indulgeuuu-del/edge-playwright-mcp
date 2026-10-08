import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export const originalHash = '7aa0bf8b6b69d32065912e3d8f7e3c18c62de4d668f770a8e039811d3cf9c6a0';
export const patchedHash = '826a7cb077c181215dcaaec460ff30173154a3941e6d80e8ec38075974235111';
const version = '1.63.0-alpha-2026-08-31';
const before = '        const url3 = tab2.page.url();\n        await tab2.page.close();\n        return url3;';
const after = `        const url3 = tab2.page.url();
        if (/^(edge|chrome):\\/\\//.test(url3))
          throw new Error(\`Browser internal tab \${url3} cannot be closed individually by Edge; use browser_close to end the automation browser.\`);
        if (url3 === "about:blank") {
          const session = await tab2.page.context().newCDPSession(tab2.page);
          try {
            const history = await session.send("Page.getNavigationHistory");
            if (history.entries.some((entry) => /^(edge|chrome):\\/\\//.test(entry.url)))
              throw new Error("This tab originated from an Edge internal page and cannot be closed individually; use browser_close to end the automation browser.");
          } finally {
            await session.detach();
          }
        }
        await tab2.page.close();
        return url3;`;

function inspect(targetRoot) {
  const core = path.join(targetRoot, 'node_modules', 'playwright-core');
  const mcp = JSON.parse(fs.readFileSync(path.join(targetRoot, 'node_modules', '@playwright', 'mcp', 'package.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
  if (mcp.version !== '0.0.80' || pkg.version !== version)
    throw new Error('Unsupported MCP/core version; review the pinned patch before upgrading.');
  const file = path.join(core, 'lib', 'coreBundle.js');
  const bytes = fs.readFileSync(file);
  return { file, bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}

export function validatePatch(targetRoot = root) {
  if (inspect(targetRoot).hash !== patchedHash)
    throw new Error('Playwright core patch is absent or modified. Run npm run patch:core, then restart the MCP.');
}

export function applyPatch(targetRoot = root) {
  const state = inspect(targetRoot);
  if (state.hash === patchedHash) return 'already-patched';
  if (state.hash !== originalHash)
    throw new Error('Unrecognized core bundle; refusing to overwrite local changes.');
  const source = state.bytes.toString('utf8');
  if (source.split(before).length !== 2) throw new Error('Patch anchor is not unique.');
  const result = Buffer.from(source.replace(before, after));
  if (createHash('sha256').update(result).digest('hex') !== patchedHash)
    throw new Error('Patch output does not match the reviewed bundle.');
  const pending = `${state.file}.patch-${randomUUID()}.pending`;
  try {
    fs.writeFileSync(pending, result, { flag: 'wx' });
    const latest = inspect(targetRoot).hash;
    if (latest === patchedHash) return 'already-patched';
    if (latest !== originalHash) throw new Error('Core bundle changed during patching.');
    fs.renameSync(pending, state.file);
    validatePatch(targetRoot);
    return 'patched';
  } finally {
    if (fs.existsSync(pending)) fs.unlinkSync(pending);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check'))
    throw new Error('Usage: node patch-core.mjs [--check]');
  if (process.argv[2] === '--check') validatePatch();
  else process.stderr.write(`Playwright core: ${applyPatch()}\n`);
}
