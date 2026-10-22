import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {isAdmin} from '../work/testbuild/admin.js';
const source=readFileSync('app/mcp/route.ts','utf8').replace(/^import .*;\n/gm,'');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let serial=0;
for(const role of ['anonymous','tester','admin'])test('Diagnostic MCP enforces administrator identity: '+role,async()=>{
 let queries=0;
 globalThis.mcpDeps={env:{ADMIN_EMAIL:'admin@example.test',DB:{}},getChatGPTUser:async()=>role==='anonymous'?null:{email:role==='admin'?'admin@example.test':'tester@example.test'},isAdmin,json:(data,status=200)=>Response.json(data,{status}),readJsonBody:r=>r.json(),diagnosticFeed:async()=>{queries++;return {records:[]};}};
 const mod=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(globalThis.mcpDeps).join(',')+'}=globalThis.mcpDeps;\n'+js+'\n//'+serial++).toString('base64'));
 const response=await mod.POST(new Request('https://example.test/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'mindscribe_diagnostics',arguments:{stream:'events'}}})}));
 assert.equal(response.status,role==='admin'?200:role==='anonymous'?401:403);assert.equal(queries,role==='admin'?1:0);
});
