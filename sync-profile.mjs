import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Explicit scope: useful profile data, never disk caches, sessions, locks or browser binaries.
const databases = ['History', 'Favicons', 'Login Data', 'Web Data', 'Network/Cookies'];
export const roots = ['Local State', ...['Preferences', 'Secure Preferences', 'Bookmarks',
  ...databases.flatMap(name => ['', '-journal', '-wal', '-shm'].map(suffix => name + suffix)), 'Local Storage', 'IndexedDB',
  'Extensions', 'Local Extension Settings', 'Extension State',
  'Sync Extension Settings'].map(x => `Default/${x}`)];
const limit = 1024 * 1024 * 1024;
const marker = 'edge-main-sync-v1';
const hashBuffer = Buffer.alloc(1024 * 1024);
function plain(p) {
  const s = fs.lstatSync(p);
  if (s.isSymbolicLink()) throw new Error(`Reparse/link path refused: ${p}`);
  return s;
}
function inside(base, relative) {
  const p = path.resolve(base, relative);
  if (!p.startsWith(path.resolve(base) + path.sep)) throw new Error('Path outside profile');
  let current = p;
  while (current !== path.resolve(base)) {
    if (fs.existsSync(current)) plain(current);
    current = path.dirname(current);
  }
  if (fs.existsSync(base)) plain(base);
  return p;
}
function atomicJson(file, value) {
  const pending = `${file}.pending`;
  const fd = fs.openSync(pending, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(pending, file);
}
export function digest(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = hashBuffer;
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
export function inventory(source) {
  plain(source);
  plain(path.join(source, 'Default'));
  const files = {};
  let bytes = 0;
  function walk(relative) {
    const p = inside(source, relative);
    if (!fs.existsSync(p)) return;
    const stat = plain(p);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) {
        if (/^(LOCK|LOG(?:\.old)?|.*\.tmp)$/i.test(name)) continue;
        walk(`${relative}/${name}`);
      }
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > limit) throw new Error('Selected profile data exceeds 1 GiB; old snapshot preserved');
      files[relative] = { bytes: stat.size, sha256: digest(p) };
    }
  }
  roots.forEach(walk);
  if (!files['Local State'] || !files['Default/Preferences']) throw new Error('Source profile incomplete');
  JSON.parse(fs.readFileSync(path.join(source, 'Local State'), 'utf8'));
  JSON.parse(fs.readFileSync(path.join(source, 'Default/Preferences'), 'utf8'));
  const revision = createHash('sha256').update(JSON.stringify({ policy: 2, files })).digest('hex');
  return { schema: marker, policy: 2, revision, bytes, files };
}
function removeGenerated(p) {
  if (!fs.existsSync(p)) return;
  plain(p);
  const m = JSON.parse(fs.readFileSync(path.join(p, 'sync-manifest.json'), 'utf8'));
  if (m.schema !== marker) throw new Error('Unmarked snapshot preserved');
  fs.rmSync(p, { recursive: true });
}
function removeStaging(seed) {
  const staging = `${seed}.staging`, guard = `${staging}.json`;
  if (fs.existsSync(guard)) {
    plain(guard);
    const markerData = JSON.parse(fs.readFileSync(guard, 'utf8'));
    if (markerData.schema !== 'edge-stage-sync-v1') throw new Error('Unknown staging preserved');
    function verify(p) { if (plain(p).isDirectory()) for (const n of fs.readdirSync(p)) verify(path.join(p, n)); }
    if (fs.existsSync(staging)) { verify(staging); fs.rmSync(staging, { recursive: true }); }
    fs.unlinkSync(guard);
  } else if (fs.existsSync(staging)) { removeGenerated(staging); }
}
export function stage(source, seed) {
  recoverSeed(seed);
  const data = inventory(source);
  const old = fs.existsSync(path.join(seed, 'sync-manifest.json'))
    ? JSON.parse(fs.readFileSync(path.join(seed, 'sync-manifest.json'), 'utf8')) : null;
  if (old?.schema === marker && old.revision === data.revision) return { changed: false, ...data, capturedAt: old.capturedAt };
  const staging = `${seed}.staging`;
  removeStaging(seed);
  atomicJson(`${staging}.json`, { schema: 'edge-stage-sync-v1' });
  fs.mkdirSync(staging);
  atomicJson(path.join(staging, 'sync-manifest.json'), data);
  for (const relative of Object.keys(data.files)) {
    const target = inside(staging, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const prior = inside(seed, relative);
    // Reuse identical prior files without rereading source for the copy.
    const usePrior = old?.files?.[relative]?.sha256 === data.files[relative].sha256 && fs.existsSync(prior);
    fs.copyFileSync(usePrior ? prior : inside(source, relative), target);
    if (digest(target) !== data.files[relative].sha256) throw new Error('Source changed while staging');
  }
  if (inventory(source).revision !== data.revision) throw new Error('Source changed during copy; not published');
  data.capturedAt = new Date().toISOString();
  atomicJson(path.join(staging, 'sync-manifest.json'), data);
  return { changed: true, ...data };
}
export function publish(seed) {
  const staging = `${seed}.staging`, previous = `${seed}.previous`;
  removeGenerated(previous);
  if (fs.existsSync(seed)) { plain(seed); fs.renameSync(seed, previous); }
  try { fs.renameSync(staging, seed); }
  catch (e) { if (fs.existsSync(previous)) fs.renameSync(previous, seed); throw e; }
  if (fs.existsSync(`${staging}.json`)) fs.unlinkSync(`${staging}.json`);
}
export function recoverSeed(seed) {
  const previous = `${seed}.previous`;
  if (!fs.existsSync(seed) && fs.existsSync(previous)) {
    plain(previous);
    const data = JSON.parse(fs.readFileSync(path.join(previous, 'sync-manifest.json'), 'utf8'));
    if (data.schema !== marker) throw new Error('Unverified previous snapshot preserved');
    fs.renameSync(previous, seed);
    return true;
  }
  return false;
}
const transactionMarker = 'edge-slot-sync-v1';
function transactionPath(statePath) { return path.join(path.dirname(statePath), 'main-sync.transaction'); }
function discardTransaction(tx) {
  // Only our journal-marked, plain transaction tree may be removed.
  const journalFile = `${tx}.json`;
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  if (journal.schema !== transactionMarker) throw new Error('Unknown sync transaction preserved');
  function verify(p) { if (plain(p).isDirectory()) for (const name of fs.readdirSync(p)) verify(path.join(p, name)); }
  if (fs.existsSync(tx)) { verify(tx); fs.rmSync(tx, { recursive: true }); }
  fs.unlinkSync(journalFile);
  if (fs.existsSync(`${journalFile}.pending`)) fs.unlinkSync(`${journalFile}.pending`);
}
export function recoverSlot(profile, statePath) {
  const tx = transactionPath(statePath);
  if (!fs.existsSync(`${tx}.json`)) {
    if (fs.existsSync(tx)) throw new Error('Unmarked slot transaction preserved');
    return false;
  }
  const journal = JSON.parse(fs.readFileSync(`${tx}.json`, 'utf8'));
  if (journal.schema !== transactionMarker) throw new Error('Unverified slot transaction preserved');
  if (journal.phase === 'prepared') {
    for (const entry of [...journal.entries].reverse()) {
      if (!entry.state && !roots.some(root => entry.relative === root || entry.relative.startsWith(`${root}/`))) throw new Error('Invalid transaction path');
      const target = entry.state ? statePath : inside(profile, entry.relative);
      const saved = inside(tx, `old/${entry.state ? '@state' : entry.relative}`);
      const staged = inside(tx, `new/${entry.state ? '@state' : entry.relative}`);
      if (fs.existsSync(saved)) {
        if (fs.existsSync(target)) { plain(target); fs.unlinkSync(target); }
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(saved, target);
      } else if (!entry.hadOld && entry.hasNew && !fs.existsSync(staged) && fs.existsSync(target)) {
        plain(target); fs.unlinkSync(target);
      }
    }
  } else if (!['preparing', 'committed'].includes(journal.phase)) throw new Error('Invalid transaction phase');
  discardTransaction(tx);
  return true;
}
export function applySnapshot(seed, profile, statePath, checkpoint = () => {}) {
  recoverSlot(profile, statePath);
  const data = JSON.parse(fs.readFileSync(path.join(seed, 'sync-manifest.json'), 'utf8'));
  if (data.schema !== marker) throw new Error('Invalid live seed');
  plain(profile); plain(path.join(profile, 'Default'));
  const old = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
  if (old?.revision === data.revision) return { changed: false, revision: data.revision };
  // Directory databases must be exact copies: leftover LevelDB tables from another
  // generation cannot be merged. Inventory only the explicitly managed roots.
  const managed = inventory(profile).files;
  const entries = [];
  for (const relative of new Set([...Object.keys(managed), ...Object.keys(data.files)])) {
    const target = inside(profile, relative), item = data.files[relative];
    if (item && managed[relative]?.sha256 === item.sha256) continue;
    entries.push({ relative, hadOld: fs.existsSync(target), hasNew: !!item });
  }
  entries.push({ state: true, hadOld: fs.existsSync(statePath), hasNew: true });
  const tx = transactionPath(statePath);
  const journal = { schema: transactionMarker, phase: 'preparing', entries };
  atomicJson(`${tx}.json`, journal);
  fs.mkdirSync(tx);
  try {
    for (const entry of entries) {
      if (!entry.hasNew) continue;
      const staged = inside(tx, `new/${entry.state ? '@state' : entry.relative}`);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      if (entry.state) atomicJson(staged, data);
      else {
        fs.copyFileSync(inside(seed, entry.relative), staged);
        if (digest(staged) !== data.files[entry.relative].sha256) throw new Error('Staged slot hash mismatch');
      }
    }
    journal.phase = 'prepared'; atomicJson(`${tx}.json`, journal);
    checkpoint('prepared');
    for (const entry of entries) {
      const target = entry.state ? statePath : inside(profile, entry.relative);
      const saved = inside(tx, `old/${entry.state ? '@state' : entry.relative}`);
      if (entry.hadOld) {
        fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.renameSync(target, saved);
        checkpoint('saved', entry);
      }
      if (entry.hasNew) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(inside(tx, `new/${entry.state ? '@state' : entry.relative}`), target);
        checkpoint('installed', entry);
      }
    }
    journal.phase = 'committed'; atomicJson(`${tx}.json`, journal);
    checkpoint('committed');
    discardTransaction(tx);
  } catch (error) {
    recoverSlot(profile, statePath);
    throw error;
  }
  return { changed: true, revision: data.revision, bytes: data.bytes };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.EDGE_SYNC_GATED === '1') {
    // No filesystem operation until the helper binds us to its kill-on-close job.
    await new Promise((resolve, reject) => {
      process.stdin.once('data', chunk => chunk.toString().trim() === 'go' ? resolve() : reject(new Error('Invalid worker gate')));
      process.stdin.once('end', () => reject(new Error('Sync helper exited before worker gate')));
    });
    process.stdin.pause();
  }
  if (!process.env.EDGE_MCP_DATA_DIR || !process.env.EDGE_MCP_MAIN_PROFILE) throw new Error('Sync requires explicit data and source directories.');
  const root = path.resolve(process.env.EDGE_MCP_DATA_DIR);
  const seed = path.join(root, 'profile-seed-live');
  if (process.argv[2] === 'stage') {
    const source = path.resolve(process.env.EDGE_MCP_MAIN_PROFILE);
    console.log(JSON.stringify(stage(source, seed)));
  } else if (process.argv[2] === 'publish') { publish(seed); }
  else if (process.argv[2] === 'recover-seed') { console.log(JSON.stringify({ recovered: recoverSeed(seed) })); }
  else if (process.argv[2] === 'apply') {
    const slotName = process.argv[3];
    if (!/^slot-[0-7]$/.test(slotName)) throw new Error('Invalid slot');
    const slot = path.join(root, 'profiles', 'shared', slotName);
    const profile = path.join(slot, 'profile');
    if (!fs.existsSync(profile)) {
      // Minimal owned baseline for a blank slot before its first browser launch.
      fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
      fs.writeFileSync(path.join(profile, 'Local State'), '{}', { flag: 'wx' });
      fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), '{}', { flag: 'wx' });
    }
    console.log(JSON.stringify(applySnapshot(seed, profile, path.join(slot, 'main-sync.json'))));
  }
  else throw new Error('Expected stage or publish');
}
