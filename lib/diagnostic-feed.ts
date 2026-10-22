import {AppError} from './ai';
// Explicit allowlist: unknown properties (including prompts, results and credentials)
// never leave the diagnostics feed, even if introduced by a future producer.
const keys=new Set(`diagnosticSchema appVersion diagnosticId jobId pipelinePhase lastCheckpointAt source exceptionType technicalMessage applicationStatus upstreamStatus aiPhase automaticRetries incomingCfRay session previousState renewed request apiRevision max_output_tokens thinking_level endpoint method timeoutMs requestBodyBytes model operation promptSha256 generationConfig maxOutputTokens thinkingConfig thinkingLevel thinkingBudget temperature background store requestStartedAt headersReceivedMs upstreamElapsedMs responseBodyBytes bodyReadMs responseHeaders requestId googleRequestId cfRay retryAfterSeconds contentType transportExceptionType transportCauseCode errorBodyState providerError code status messagePresent response bodyShape responseId modelVersion promptFeedback blockReason safetyRatings category probability blocked blockReasonMessagePresent candidateCount candidates candidatesTruncated index finishReason finishMessagePresent tokenCount partCount visibleTextCharacters thoughtPartCount nonTextPartCount validation outcome pipelineTimings phase startedMs durationMs savedAudioId audioBytesRead providerDeleted interaction id stepCount stepsCount textCharacters errorPresent usage source model promptTokens cachedTokens outputTokens thinkingTokens totalTokens toolTokens estimateUsd reason priceVersion ratesPerMillion input cached output priceSource measuredAt serviceTier clientRequestId serverRequestId`.split(' '));
export function safeDiagnostics(raw:any):any {
 if(raw===null||typeof raw==='number'||typeof raw==='boolean')return raw;
 if(typeof raw==='string')return raw.slice(0,500);
 if(Array.isArray(raw))return raw.slice(0,100).map(safeDiagnostics);
 if(!raw||typeof raw!=='object')return null;
 return Object.fromEntries(Object.entries(raw).filter(([key])=>keys.has(key)).map(([key,value])=>[key,safeDiagnostics(value)]));
}
const parse=(raw:any)=>{try{return safeDiagnostics(JSON.parse(raw||'{}'));}catch{return {technicalMessage:'DIAGNOSTICS_PARSE_FAILED'};}};
export async function diagnosticFeed(db:D1Database,args:any){
 const stream=args?.stream||'events',after=args?.afterTime??0,afterId=args?.afterId??'',limit=Math.min(args?.limit??50,100);
 if(!['events','browser','jobs','steps'].includes(stream)||!Number.isSafeInteger(after)||after<0||typeof afterId!=='string'||afterId.length>100||!Number.isSafeInteger(limit)||limit<1)throw new AppError('Invalid diagnostic cursor',400);
 const config:any={events:['test_events','started_at','id,user_id,visit_id,stage,provider,status,started_at,elapsed_ms,duration_ms,error_code,model,audio_bytes,audio_format,diagnostics'],browser:['client_reports','received_at','id,owner_id,visit_id,job_id,received_at,details'],jobs:['processing_jobs','updated_at','id,owner_id,visit_id,stage,state,created_at,updated_at,lease_until,diagnostics'],steps:['processing_steps','at','id,job_id,at,phase,details']};
 const [table,time,columns]=config[stream];
 const rows:any[]=(await db.prepare(`SELECT ${columns} FROM ${table} WHERE ${time}>? OR (${time}=? AND id>?) ORDER BY ${time},id LIMIT ?`).bind(after,after,afterId,limit+1).all()).results;
 const more=rows.length>limit;const page=rows.slice(0,limit),last=page.at(-1);
 return {stream,records:page.map(row=>{const {diagnostics,details,...meta}=row;return {...meta,...(diagnostics?{diagnostics:parse(diagnostics)}:{}),...(details?{details:stream==='browser'?browserDetails(details):parse(details)}:{})};}),hasMore:more,next:last?{afterTime:last[time],afterId:last.id}:{afterTime:after,afterId}};
}
function browserDetails(raw:string){try{const d=JSON.parse(raw);return Object.fromEntries(['id','visitId','jobId','requestId','serverRequestId','version','kind','path','method','status','elapsedMs','at','contentType','redirected','online','visibility','cfRay'].filter(k=>Object.hasOwn(d,k)).map(k=>[k,d[k]]));}catch{return {kind:'UNREADABLE_REPORT'};}}
