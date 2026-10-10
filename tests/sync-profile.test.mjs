import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stage, publish, applySnapshot, recoverSlot, recoverSeed } from '../sync-profile.mjs';
import { spawnSync } from 'node:child_process';

test('bounded snapshot, unchanged capture, managed deletion and unmanaged preservation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-sync-test-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const source = path.join(root, 'source'), seed = path.join(root, 'seed'), slot = path.join(root, 'slot');
  for (const p of [source, slot]) {
    fs.mkdirSync(path.join(p, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(p, 'Local State'), '{}');
    fs.writeFileSync(path.join(p, 'Default', 'Preferences'), '{}');
  }
  fs.mkdirSync(path.join(source, 'Default', 'Cache'));
  fs.writeFileSync(path.join(source, 'Default', 'Cache', 'excluded'), 'cache');
  fs.mkdirSync(path.join(source, 'Default', 'Local Storage'));
  fs.writeFileSync(path.join(source, 'Default', 'Local Storage', 'table'), 'new');
  fs.writeFileSync(path.join(source, 'Default', 'Local Storage', 'LOCK'), 'lock');
  fs.mkdirSync(path.join(slot, 'Default', 'Local Storage'));
  fs.writeFileSync(path.join(slot, 'Default', 'Local Storage', 'stale'), 'stale');
  fs.writeFileSync(path.join(slot, 'Default', 'unmanaged'), 'keep');
  const first = stage(source, seed); assert(first.changed); publish(seed);
  assert(!fs.existsSync(path.join(seed, 'Default', 'Cache')));
  assert(!fs.existsSync(path.join(seed, 'Default', 'Local Storage', 'LOCK')));
  assert.equal(stage(source, seed).changed, false);
  const state = path.join(root, 'state.json');
  applySnapshot(seed, slot, state);
  assert(!fs.existsSync(path.join(slot, 'Default', 'Local Storage', 'stale')));
  assert.equal(fs.readFileSync(path.join(slot, 'Default', 'unmanaged'), 'utf8'), 'keep');
  assert.equal(applySnapshot(seed, slot, state).changed, false);
  fs.unlinkSync(path.join(source, 'Default', 'Local Storage', 'table'));
  stage(source, seed); publish(seed); applySnapshot(seed, slot, state);
  assert(!fs.existsSync(path.join(slot, 'Default', 'Local Storage', 'table')));
  assert(fs.existsSync(`${seed}.previous`));
});

test('invalid JSON does not replace published seed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-sync-test-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const source = path.join(root, 'source'), seed = path.join(root, 'seed');
  fs.mkdirSync(path.join(source, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(source, 'Local State'), '{}');
  fs.writeFileSync(path.join(source, 'Default', 'Preferences'), '{}');
  stage(source, seed); publish(seed);
  const before = fs.readFileSync(path.join(seed, 'sync-manifest.json'), 'utf8');
  fs.writeFileSync(path.join(source, 'Default', 'Preferences'), '{');
  assert.throws(() => stage(source, seed));
  assert.equal(fs.readFileSync(path.join(seed, 'sync-manifest.json'), 'utf8'), before);
});

test('oversized selected file is rejected before hashing or copying', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-sync-test-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const source = path.join(root,'source'), seed = path.join(root,'seed');
  fs.mkdirSync(path.join(source,'Default'),{recursive:true});
  fs.writeFileSync(path.join(source,'Local State'),'{}');
  fs.writeFileSync(path.join(source,'Default','Preferences'),'{}');
  const fd=fs.openSync(path.join(source,'Default','History'),'w');
  fs.ftruncateSync(fd,1024*1024*1024+1); fs.closeSync(fd);
  assert.throws(()=>stage(source,seed),/exceeds 1 GiB/);
  assert(!fs.existsSync(seed));
});

function recoveryFixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'edge-sync-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true}));
  const source=path.join(root,'source'), seed=path.join(root,'seed'), slot=path.join(root,'slot'), state=path.join(root,'state.json');
  for(const dir of [source,slot]) {
    fs.mkdirSync(path.join(dir,'Default','Local Storage'),{recursive:true});
    fs.writeFileSync(path.join(dir,'Local State'),'{}');
    fs.writeFileSync(path.join(dir,'Default','Preferences'),JSON.stringify({source:dir===source}));
  }
  fs.writeFileSync(path.join(slot,'Default','Local Storage','old-table'),'old');
  fs.writeFileSync(path.join(source,'Default','Local Storage','new-table'),'new');
  fs.writeFileSync(state,JSON.stringify({revision:'prior'}));
  stage(source,seed); publish(seed);
  return {root,source,seed,slot,state};
}
for(const phase of ['prepared','saved','installed','state-installed','committed']) {
  test(`abrupt worker exit at ${phase} recovers before reuse`, t=> {
    const f=recoveryFixture(t);
    const oldPrefs=fs.readFileSync(path.join(f.slot,'Default','Preferences'),'utf8');
    const moduleUrl=new URL('../sync-profile.mjs',import.meta.url).href;
    const code=`import {applySnapshot} from ${JSON.stringify(moduleUrl)};
      applySnapshot(${JSON.stringify(f.seed)},${JSON.stringify(f.slot)},${JSON.stringify(f.state)},(event,entry)=>{
        if(event===${JSON.stringify(phase)} || (${JSON.stringify(phase)}==='state-installed' && event==='installed' && entry?.state)) process.exit(71);
      });`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',code]);
    assert.equal(run.status,71);
    assert(recoverSlot(f.slot,f.state));
    if(phase!=='committed') {
      assert.equal(fs.readFileSync(path.join(f.slot,'Default','Preferences'),'utf8'),oldPrefs);
      assert.equal(fs.readFileSync(path.join(f.slot,'Default','Local Storage','old-table'),'utf8'),'old');
      assert(!fs.existsSync(path.join(f.slot,'Default','Local Storage','new-table')));
      assert.equal(JSON.parse(fs.readFileSync(f.state,'utf8')).revision,'prior');
    } else {
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.slot,'Default','Preferences'),'utf8')).source,true);
      assert(fs.existsSync(path.join(f.slot,'Default','Local Storage','new-table')));
    }
    assert(!fs.existsSync(path.join(f.root,'main-sync.transaction')));
    assert(!fs.existsSync(path.join(f.root,'main-sync.transaction.json')));
    assert.doesNotThrow(()=>applySnapshot(f.seed,f.slot,f.state));
  });
}
test('ordinary copy/commit error rolls back immediately',t=>{
  const f=recoveryFixture(t);
  assert.throws(()=>applySnapshot(f.seed,f.slot,f.state,event=>{if(event==='saved')throw new Error('Injected failure');}),/Injected failure/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.slot,'Default','Preferences'),'utf8')).source,false);
  assert.equal(JSON.parse(fs.readFileSync(f.state,'utf8')).revision,'prior');
});
test('publication interruption restores previous seed without source access',t=>{
  const f=recoveryFixture(t);
  const prior=JSON.parse(fs.readFileSync(path.join(f.seed,'sync-manifest.json'),'utf8')).revision;
  fs.writeFileSync(path.join(f.source,'Default','Preferences'),'{}');
  stage(f.source,f.seed);
  fs.renameSync(f.seed,`${f.seed}.previous`);
  assert(recoverSeed(f.seed));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.seed,'sync-manifest.json'),'utf8')).revision,prior);
  assert(fs.existsSync(`${f.seed}.staging`));
  publish(f.seed);
  assert(fs.existsSync(f.seed));
});
test('all SQLite families include journal/WAL/SHM and clear stale side files',t=>{
  const f=recoveryFixture(t);
  for(const db of ['History','Favicons','Login Data','Web Data','Network/Cookies']) {
    for(const suffix of ['','-journal','-wal','-shm']) {
      const p=path.join(f.source,'Default',db+suffix);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture');
    }
  }
  stage(f.source,f.seed);publish(f.seed);applySnapshot(f.seed,f.slot,f.state);
  assert(fs.existsSync(path.join(f.slot,'Default','Web Data-wal')));
  assert(fs.existsSync(path.join(f.slot,'Default','Login Data-shm')));
  fs.unlinkSync(path.join(f.source,'Default','Web Data-wal'));
  stage(f.source,f.seed);publish(f.seed);applySnapshot(f.seed,f.slot,f.state);
  assert(!fs.existsSync(path.join(f.slot,'Default','Web Data-wal')));
});

test('cancelled staging with an unfinished manifest can be safely rebuilt',t=>{
  const f=recoveryFixture(t);
  const staging=`${f.seed}.staging`;
  fs.mkdirSync(staging);
  fs.writeFileSync(`${staging}.json`,JSON.stringify({schema:'edge-stage-sync-v1'}));
  fs.writeFileSync(path.join(staging,'sync-manifest.json.pending'),'{');
  fs.writeFileSync(path.join(f.source,'Default','Preferences'),'{}');
  assert.equal(stage(f.source,f.seed).changed,true);
  publish(f.seed);
  assert(!fs.existsSync(staging));
  assert(!fs.existsSync(`${staging}.json`));
});
