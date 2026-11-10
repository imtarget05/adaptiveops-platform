import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/env';

export const corsMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const origin = c.req.header('Origin') || '*';
  
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-GitHub-Delivery, X-GitHub-Event, X-Hub-Signature-256',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
      }
    });
  }

  await next();

  c.res.headers.set('Access-Control-Allow-Origin', origin);
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-GitHub-Delivery, X-GitHub-Event, X-Hub-Signature-256');
  c.res.headers.set('Vary', 'Origin');
};
