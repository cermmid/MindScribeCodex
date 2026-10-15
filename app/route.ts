import { HTML } from '../lib/shell';
import { headers } from '../lib/http';
import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
export const dynamic='force-dynamic';
export async function GET() {
 const user=await getChatGPTUser();
 const login=`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MindScribe · Logowanie</title><link rel="stylesheet" href="/style.css"><main><section class="card"><p class="eyebrow">MINDSCRIBE · TESTY</p><h1>Zaloguj się, aby rozpocząć.</h1><p>Do testowania potrzebujesz konta ChatGPT. Twoja historia wizyt jest dostępna tylko dla Ciebie.</p><p>Właściciel widzi Twoją nazwę i e-mail oraz statystyki prób: ich wynik, długość nagrań i czas przetwarzania. Panel statystyk nie zawiera treści wizyt ani nagrań. Wyjątkiem są notatki, które świadomie udostępnisz wraz z feedbackiem.</p><a class="primary download-button" target="_top" href="${chatGPTSignInPath('/')}">Zaloguj przez ChatGPT</a></section></main></html>`;
 return new Response(user?HTML:login,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}
