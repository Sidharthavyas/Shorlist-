export interface Env {
  DB:D1Database; FILES:R2Bucket; TASKS:Queue;
  ASSETS:Fetcher; APP_ENV:string; APP_ORIGIN:string;
  ACCESS_ISSUER:string; ACCESS_AUDIENCE:string; OWNER_EMAIL?:string;
  FREEHIRE_API_KEY?:string; TELEGRAM_BOT_TOKEN?:string; TELEGRAM_CHAT_ID?:string;
  GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string; GOOGLE_TOKEN_ENCRYPTION_KEY?:string;
}
export const OWNER = 'primary-owner';
