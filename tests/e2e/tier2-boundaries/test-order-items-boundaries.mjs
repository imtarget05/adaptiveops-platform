/**
 * Tier 2 - Boundary & Corner Cases: Order Items & Amounts Validation
 *
 * Exercises payload validation boundary rules:
 * - Empty items array [] rejected (400)
 * - Zero quantity item rejected (400)
 * - Negative unit price rejected (400)
 * - Zero total amount rejected (400)
 * - Order with 100 items computes accurate total
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 2 - Order Items & Amounts Boundaries';

export async function run(client) {
  // Boundary 1: Empty items array rejected with 400
  {
    const payload = {
      customerId: 'cust-boundary-1',
      items: [],
      totalAmount: 100.00,
    };
    const res = await client.createOrder(payload, crypto.randomUUID());
    assertStatus(res, 400, 'Empty items array must return 400 Bad Request');
  }

  // Boundary 2: Zero quantity item rejected with 400
  {
    const payload = {
      customerId: 'cust-boundary-2',
      items: [{ sku: 'SKU-0', quantity: 0, unitPrice: 10.00 }],
      totalAmount: 10.00,
    };
    const res = await client.createOrder(payload, crypto.randomUUID());
    assertStatus(res, 400, 'Item with quantity 0 must return 400 Bad Request');
  }

  // Boundary 3: Negative unit price rejected with 400
  {
    const payload = {
      customerId: 'cust-boundary-3',
      items: [{ sku: 'SKU-NEG', quantity: 1, unitPrice: -5.00 }],
      totalAmount: 5.00,
    };
    const res = await client.createOrder(payload, crypto.randomUUID());
    assertStatus(res, 400, 'Negative unit price must return 400 Bad Request');
  }

  // Boundary 4: Zero total amount rejected with 400
  {
    const payload = {
      customerId: 'cust-boundary-4',
      items: [{ sku: 'SKU-FREE', quantity: 1, unitPrice: 0.00 }],
      totalAmount: 0.00,
    };
    const res = await client.createOrder(payload, crypto.randomUUID());
    assertStatus(res, 400, 'totalAmount <= 0 must return 400 Bad Request');
  }

  // Boundary 5: Order with 100 items succeeds and sums correctly
  {
    const items = Array.from({ length: 100 }, (_, i) => ({
      sku: `SKU-BULK-${i}`,
      quantity: 1,
      unitPrice: 1.50,
    }));
    const payload = {
      customerId: 'cust-boundary-5',
      items,
      totalAmount: 150.00,
    };
    const res = await client.createOrder(payload, crypto.randomUUID());
    assertStatus(res, 201, 'Valid bulk order with 100 items should succeed');
    assertEqual(res.data.totalAmount, 150.00);
  }
}
