import type { ChatGPTUser } from '../app/chatgpt-auth';
// Exact trusted identity match, never a browser-supplied admin flag.
export function isAdmin(user:ChatGPTUser|null, settings:{ADMIN_EMAIL?:string}) {
  return Boolean(user && settings.ADMIN_EMAIL && user.email.toLowerCase()===settings.ADMIN_EMAIL.trim().toLowerCase());
}
