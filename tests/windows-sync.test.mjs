import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Windows job kills its worker if helper is terminated', {skip:process.platform!=='win32'},async t=>{
  const helper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'tests','job-probe.ps1'),'-NodePath',process.execPath],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(()=>helper.kill());
  let out='',err=''; helper.stdout.on('data',c=>out+=c); helper.stderr.on('data',c=>err+=c);
  const deadline=Date.now()+15000;
  while(!/^\d+\s*$/m.test(out) && Date.now()<deadline && helper.exitCode===null) await delay(100);
  assert(/^\d+\s*$/m.test(out),err || 'No worker PID');
  const pid=Number(out.trim());
  process.kill(pid,0);
  helper.kill();
  let alive=true;
  for(let i=0;i<100;i++) {
    try{process.kill(pid,0);}catch{alive=false;break;}
    await delay(50);
  }
  assert.equal(alive,false,'Job worker must terminate with helper');
});
test('gated worker exits without touching seed when helper stdin closes', t=>{
  const result=spawnSync(process.execPath,[path.join(root,'sync-profile.mjs'),'stage'],{
    env:{...process.env,EDGE_SYNC_GATED:'1'},input:'',encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);
  assert(result.stderr.includes('before worker gate'));
});
