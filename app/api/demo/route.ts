import {getChatGPTUser} from '../../chatgpt-auth';
import demo from '../../../lib/demo.json';
import { json } from '../../../lib/http';
export async function GET() { if(!await getChatGPTUser()) return json({error:'Zaloguj się przez ChatGPT.'},401); return json(demo); }
