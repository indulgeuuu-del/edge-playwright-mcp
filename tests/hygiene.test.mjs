import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('tracked source excludes browser data, machine paths and credential-like tokens', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  assert(files.length > 0);
  for (const file of files) {
    assert(!/^(node_modules|profiles?|profile-seed.*|output|work)\//.test(file), `Private/generated path: ${file}`);
    assert(!/\.(db|sqlite|lnk|exe|log)$/.test(file), `Generated artifact: ${file}`);
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!/gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text), `Credential-like text in ${file}`);
    assert(!/C:[\\/]Users[\\/]\d+[\\/]/i.test(text), `Personal path in ${file}`);
  }
});
