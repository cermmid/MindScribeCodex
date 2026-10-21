import { AppError } from './ai';

const COOKIE = 'mindscribe_session';
const text = new TextEncoder();
async function key(secret:string) { return crypto.subtle.importKey('raw',text.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']); }
function hex(bytes:ArrayBuffer) { return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''); }
export async function session(request:Request,secret:string,create=false) {
  const value = request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  let previousState='missing';
  if(value) {
    previousState='malformed';
    const [id,expiry,signature,...extra] = value.split('.');
    if(!extra.length && /^[a-f0-9-]{36}$/.test(id||'') && /^\d+$/.test(expiry||'') && /^[a-f0-9]{64}$/.test(signature||'') && Number.isSafeInteger(Number(expiry))) {
      const bytes=Uint8Array.from(signature.match(/../g)!,b=>parseInt(b,16));
      const verified=await crypto.subtle.verify('HMAC',await key(secret),bytes,text.encode(id+'.'+expiry));
      previousState=verified?'expired':'invalid_signature';
      if(verified && Number(expiry)>Date.now()) return {id,cookie:null,diagnostics:{previousState:'valid',renewed:false}};
    }
  }
  if(!create) throw new AppError('Sesja wygasła. Pobierz nagranie lub skopiuj tekst przed odświeżeniem strony.',403,{source:'application_session',technicalMessage:'APP_SESSION_REQUIRED',session:{previousState,renewed:false}});
  const id=crypto.randomUUID(), expiry=String(Date.now()+24*60*60*1000);
  const sig=hex(await crypto.subtle.sign('HMAC',await key(secret),text.encode(id+'.'+expiry)));
  return {id,diagnostics:{previousState,renewed:true},cookie:`${COOKIE}=${id}.${expiry}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`};
}
export function sameOrigin(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin || request.headers.get('x-mindscribe-request')!=='1') throw new AppError('Niedozwolone źródło żądania.',403);
}
export async function consume(db:D1Database,id:string,kind:'audio'|'note'|'check') {
  const day=new Date().toISOString().slice(0,10);
  // D1 serializes each conditional increment; quotas hold across Worker instances.
  // Count attempted upstream calls too, including failed paid requests.
  for(const [bucket,limit] of [[`${day}:global:${kind}`,kind==='audio'?40:kind==='check'?40:80],[`${day}:${id}:${kind}`,kind==='audio'?6:kind==='check'?8:18]] as const) {
    const result=await db.prepare('INSERT INTO usage_buckets (bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count').bind(bucket,limit).first();
    if(!result) throw new AppError('Osiągnięto dzienny limit wersji testowej. Spróbuj jutro; materiał pozostał w tej karcie.',429);
  }
  await db.prepare('DELETE FROM usage_buckets WHERE substr(bucket,1,10) < ?').bind(new Date(Date.now()-7*86400000).toISOString().slice(0,10)).run();
}
