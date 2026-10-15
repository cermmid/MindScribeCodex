// Only numeric accounting fields are retained; never provider response contents.
const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;
export function measureUsage(raw:any,model:string,at=Date.now()){
 if(!raw||typeof raw!=='object')return null;
 const usage={source:'gemini_usageMetadata',model,promptTokens:count(raw.promptTokenCount),cachedTokens:count(raw.cachedContentTokenCount)??0,outputTokens:count(raw.candidatesTokenCount),thinkingTokens:count(raw.thoughtsTokenCount)??0,totalTokens:count(raw.totalTokenCount),toolTokens:count(raw.toolUsePromptTokenCount)??0};
 let estimateUsd:number|null=null,reason='Nieznany model, cennik lub niepełny raport zużycia.';
 const date=new Date(at).toISOString().slice(0,10);
 const rates=model==='gemini-3.8-flash'&&date>='2026-10-15'&&date<='2026-12-31'?{input:0.75,cached:0.075,output:3.75}:null;
 if(rates&&usage.promptTokens!==null&&usage.outputTokens!==null&&usage.totalTokens!==null&&usage.cachedTokens<=usage.promptTokens&&usage.toolTokens===0&&usage.totalTokens===usage.promptTokens+usage.outputTokens+usage.thinkingTokens&&(!raw.serviceTier||raw.serviceTier==='STANDARD')){
 estimateUsd=((usage.promptTokens-usage.cachedTokens)*rates.input+usage.cachedTokens*rates.cached+(usage.outputTokens+usage.thinkingTokens)*rates.output)/1000000;
 reason='Cena katalogowa Standard USD, bez podatków, kredytów, rabatów i kosztów hostingu. Nie jest rachunkiem Google.';
 }
 return {...usage,estimateUsd,reason,priceVersion:rates?'google-standard-2026-10-15':null,ratesPerMillion:rates,priceSource:'https://ai.google.dev/gemini-api/docs/pricing',measuredAt:at};
}
export const COST_COLUMNS=`COUNT(*) AS attempts,
 COUNT(json_extract(diagnostics,'$.usage.totalTokens')) AS measured,
 COUNT(json_extract(diagnostics,'$.usage.estimateUsd')) AS priced,
 SUM(json_extract(diagnostics,'$.usage.totalTokens')) AS tokens,
 SUM(json_extract(diagnostics,'$.usage.promptTokens')) AS input_tokens,
 SUM(json_extract(diagnostics,'$.usage.outputTokens')) AS output_tokens,
 SUM(json_extract(diagnostics,'$.usage.thinkingTokens')) AS thinking_tokens,
 SUM(json_extract(diagnostics,'$.usage.cachedTokens')) AS cached_tokens,
 SUM(json_extract(diagnostics,'$.usage.estimateUsd')) AS estimated_usd`;
