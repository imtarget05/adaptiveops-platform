export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  API_VERSION?: string;
  CORS_ALLOWED_ORIGINS?: string;
  ADMIN_API_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
}
