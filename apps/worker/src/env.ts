import type { PrivateFiles } from './private-files';
import type {TaskQueue} from './durable-work';
export interface Env {
  DB:D1Database; FILES:PrivateFiles; TASKS:TaskQueue;
  ASSETS:Fetcher; APP_ENV:string; APP_ORIGIN:string;
  ACCESS_ISSUER:string; ACCESS_AUDIENCE:string; OWNER_EMAIL?:string;
  DEPLOYMENT_PROXY_SECRET?:string; OWNER_SESSION_SECRET?:string; OWNER_PASSWORD_HASH?:string;
  MONGO_STORAGE_URL?:string; MONGO_STORAGE_SECRET?:string;
  DURABLE_WORK?:string;
  USER_ID?:string; MULTI_USER?:string; DISCOVERY_PAUSED?:string; DISCOVERY_RESUME_AT?:string;
  FREEHIRE_API_KEY?:string; TELEGRAM_BOT_TOKEN?:string; TELEGRAM_CHAT_ID?:string;
  GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string; GOOGLE_TOKEN_ENCRYPTION_KEY?:string;
}
export const OWNER = 'primary-owner';
export const owner=(env:Env)=>env.USER_ID??OWNER;
export const discoveryPaused=(env:Env)=>env.DISCOVERY_PAUSED==='true'&&(!env.DISCOVERY_RESUME_AT||Date.now()<Date.parse(env.DISCOVERY_RESUME_AT));
