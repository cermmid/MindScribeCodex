import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
mkdirSync('work/testbuild',{recursive:true});
for(const name of ['ai','access','note-prompt','visits','admin','test-events','feedback','audio-storage','usage']) {
  const input=readFileSync(`lib/${name}.ts`,'utf8');
  const result=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  writeFileSync(`work/testbuild/${name}.js`,result.outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.js'"));
}
const r=spawnSync(process.execPath,['--test','tests/backend.test.mjs','tests/audio-flow.test.mjs','tests/visits.test.mjs','tests/admin.test.mjs','tests/feedback.test.mjs','tests/audio-storage.test.mjs','tests/error-route.test.mjs','tests/usage.test.mjs'],{stdio:'inherit'});
process.exit(r.status??1);
