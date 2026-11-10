import { Hono } from 'hono';
import type { Env } from '../types/env';
import { verifyGitHubSignature } from '../services/cryptoService';
import { processGitHubWebhook } from '../services/webhookService';

export const webhookRoutes = new Hono<{ Bindings: Env }>();

webhookRoutes.post('/github', async (c) => {
  const deliveryId = c.req.header('X-GitHub-Delivery');
  const eventType = c.req.header('X-GitHub-Event');
  const signatureHeader = c.req.header('X-Hub-Signature-256');

  if (!deliveryId || !eventType) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Missing required GitHub webhook headers (X-GitHub-Delivery, X-GitHub-Event)'
      },
      400
    );
  }

  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return c.json(
      { error: 'Service Unavailable', message: 'GitHub webhook verification is not configured' },
      503
    );
  }

  // Read raw payload ArrayBuffer for constant-time HMAC-SHA256 signature verification
  const rawBody = await c.req.raw.arrayBuffer();

  const isValidSignature = await verifyGitHubSignature(secret, rawBody, signatureHeader);
  if (!isValidSignature) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Invalid or missing cryptographic signature in X-Hub-Signature-256'
      },
      401
    );
  }

  const payloadText = new TextDecoder().decode(rawBody);

  try {
    const result = await processGitHubWebhook(c.env, deliveryId, eventType, payloadText);

    if (result.duplicate) {
      return c.json(
        {
          status: 'already_processed',
          delivery_id: deliveryId,
          message: result.message
        },
        202
      );
    }

    return c.json(
      {
        success: true,
        delivery_id: deliveryId,
        event: eventType,
        action: result.action,
        deployment_id: result.deploymentId,
        status: result.status,
        environment: result.environment
      },
      200
    );
  } catch (err: any) {
    if (err.status === 400 || err.message === 'Malformed JSON payload') {
      return c.json(
        { error: 'Bad Request', message: 'Malformed JSON payload' },
        400
      );
    }
    console.error('Webhook processing failure:', err);
    return c.json(
      {
        error: 'Internal Server Error',
        message: err.message || 'Failed to process webhook payload'
      },
      500
    );
  }
});
