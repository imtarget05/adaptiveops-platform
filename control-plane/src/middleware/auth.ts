import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/env';

export const adminAuthMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const configuredKey = c.env.ADMIN_API_KEY;
  if (!configuredKey) {
    // Fail-closed: without a configured admin key, reject all admin requests.
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Administrative API key not configured on control plane'
      },
      401
    );
  }

  const apiKeyHeader = c.req.header('X-API-Key');
  const authHeader = c.req.header('Authorization');
  let bearerToken: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  const providedKey = apiKeyHeader || bearerToken;
  if (!providedKey || providedKey !== configuredKey) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Invalid or missing administrative API key in X-API-Key or Authorization header'
      },
      401
    );
  }

  await next();
};
