import {AppError} from './ai';
export async function readJsonBody(request:Request) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('Wymagany format JSON.',415);
  const reader=request.body?.getReader(); if(!reader) throw new AppError('Brak danych.');
  const chunks:Uint8Array[]=[];let size=0;
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw new AppError('Za dużo danych.',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
  try {const data=JSON.parse(new TextDecoder().decode(bytes));if(!data || typeof data!=='object')throw new Error();return data;}catch{throw new AppError('Nieprawidłowe dane.');}
}