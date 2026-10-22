import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {sameOrigin} from '../../../lib/access';
import {AppError} from '../../../lib/ai';
import {json} from '../../../lib/http';
import {readJsonBody} from '../../../lib/request-body';
import {saveClientReport} from '../../../lib/client-reports';
export async function POST(request:Request){try{const user=await getChatGPTUser();if(!user)throw new AppError('Zaloguj się.',401);sameOrigin(request);const data=await readJsonBody(request);await saveClientReport((env as unknown as {DB:D1Database}).DB,user,data);return json({saved:true});}catch(e){return json({error:e instanceof AppError?e.message:'Nie zapisano raportu.'},e instanceof AppError?e.status:500);}}
