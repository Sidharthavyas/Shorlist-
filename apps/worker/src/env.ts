import type { PrivateFiles } from './private-files';
export interface Env {
  DB:D1Database; FILES:PrivateFiles; TASKS:Queue;
  ASSETS:Fetcher; APP_ENV:string; APP_ORIGIN:string;
  ACCESS_ISSUER:string; ACCESS_AUDIENCE:string; OWNER_EMAIL?:string;
  DEPLOYMENT_PROXY_SECRET?:string; OWNER_SESSION_SECRET?:string; OWNER_PASSWORD_HASH?:string;
  MONGO_STORAGE_URL?:string; MONGO_STORAGE_SECRET?:string;
  FREEHIRE_API_KEY?:string; TELEGRAM_BOT_TOKEN?:string; TELEGRAM_CHAT_ID?:string;
  GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string; GOOGLE_TOKEN_ENCRYPTION_KEY?:string;
}
export const OWNER = 'primary-owner';
