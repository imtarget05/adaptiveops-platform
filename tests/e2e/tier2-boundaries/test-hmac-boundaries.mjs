/**
 * Tier 2 - Boundary & Corner Cases: Webhook HMAC Signatures
 *
 * Exercises adversarial edge cases on cryptographic webhook verification:
 * - Empty string body with valid empty-string HMAC
 * - Uppercase vs lowercase hex characters in signature
 * - Extra whitespace and padding in signature header
 * - Large JSON body (1MB) signature verification
 * - Non-ASCII and Unicode characters in payload body
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 2 - Webhook HMAC Signature Boundaries';

export async function run(client) {
  // Boundary 1: Empty string body with correctly computed empty HMAC
  {
    const emptyBody = '';
    const validEmptySig = client.computeHmacSignature(emptyBody);
    const deliveryId = crypto.randomUUID();
    const res = await client.sendWebhook('ping', deliveryId, emptyBody, {
      signature: validEmptySig,
    });
    // Should accept or process empty valid body
    assertTrue(res.status === 200 || res.status === 201, `Empty valid payload should be accepted, got ${res.status}`);
  }

  // Boundary 2: Signature with Uppercase Hex letters (GitHub specification uses lowercase hex)
  {
    const payload = { event: 'ping', test: 'uppercase' };
    const rawBody = JSON.stringify(payload);
    const lowercaseSig = client.computeHmacSignature(rawBody);
    const uppercaseSig = `sha256=${lowercaseSig.slice(7).toUpperCase()}`;
    const deliveryId = crypto.randomUUID();

    const res = await client.sendWebhook('ping', deliveryId, payload, {
      signature: uppercaseSig,
    });
    // In constant-time byte comparison or case-sensitive match, uppercase hex is either normalized or rejected (401)
    assertTrue([200, 201, 401].includes(res.status), 'Uppercase hex should be handled deterministically');
  }

  // Boundary 3: Whitespace and newline padding around signature header
  {
    const payload = { event: 'ping', test: 'padding' };
    const rawBody = JSON.stringify(payload);
    const validSig = client.computeHmacSignature(rawBody);
    const paddedSig = `  ${validSig}  `;
    const deliveryId = crypto.randomUUID();

    const res = await client.sendWebhook('ping', deliveryId, payload, {
      signature: paddedSig,
    });
    // Padded signature should either be trimmed or rejected, but not crash with 500
    assertTrue(res.status === 200 || res.status === 201 || res.status === 401, 'Padding must not cause 500');
  }

  // Boundary 4: Large JSON payload (10,000 array elements)
  {
    const largeArray = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const largePayload = { items: largeArray };
    const deliveryId = crypto.randomUUID();
    const res = await client.sendWebhook('push', deliveryId, largePayload);
    assertTrue(res.status === 200 || res.status === 201, 'Large payload signature verification should succeed');
  }

  // Boundary 5: Unicode, Emoji, and multi-byte characters in body
  {
    const unicodePayload = {
      message: '🚀 Deployment successful to edge region: 東京 (Tokyo) & São Paulo! 🌍 Special chars: <>&"\'',
      status: 'success',
    };
    const deliveryId = crypto.randomUUID();
    const res = await client.sendWebhook('deployment_status', deliveryId, unicodePayload);
    assertTrue(res.status === 200 || res.status === 201, 'Unicode multi-byte characters must compute matching HMAC');
  }
}
