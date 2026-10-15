export const headers = {
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer', 'Permissions-Policy':'microphone=(self)',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com; base-uri 'none'; form-action 'self'",
};
export function json(data:unknown,status=200,extra:Record<string,string>={}) { return Response.json(data,{status,headers:{...headers,...extra}}); }
