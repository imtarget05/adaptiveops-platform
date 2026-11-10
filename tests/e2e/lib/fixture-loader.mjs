/**
 * AdaptiveOps E2E Test Suite - Fixture Loader & Generators
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

export class FixtureLoader {
  static loadJson(filename) {
    const filePath = path.join(FIXTURES_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  }

  static loadText(filename) {
    const filePath = path.join(FIXTURES_DIR, filename);
    return fs.readFileSync(filePath, 'utf8');
  }

  static loadWebhooks() {
    return this.loadJson('github_webhooks.json');
  }

  static loadHealthProbes() {
    return this.loadJson('health_probes.json');
  }

  static loadOrders() {
    return this.loadJson('orders.json');
  }

  static generateRandomOrder(overrides = {}) {
    const idSuffix = crypto.randomUUID().slice(0, 8);
    const qty = Math.floor(Math.random() * 5) + 1;
    const price = Math.round((Math.random() * 80 + 10) * 100) / 100;
    const total = Math.round(qty * price * 100) / 100;

    return {
      customerId: `cust-${idSuffix}`,
      items: [
        {
          sku: `SKU-${idSuffix.toUpperCase()}`,
          quantity: qty,
          unitPrice: price,
        },
      ],
      totalAmount: total,
      ...overrides,
    };
  }

  static generateWebhookPayload(type = 'deployment', overrides = {}) {
    const webhooks = this.loadWebhooks();
    const base = webhooks[type] || webhooks.deployment_event;
    return { ...base, ...overrides };
  }

  static generateHealthProbe(environment = 'kubernetes', status = 'healthy', latency = 45) {
    return {
      environment,
      service_name: 'order-service',
      endpoint_url: `http://${environment}-order-service:8080/actuator/health`,
      http_status: status === 'healthy' ? 200 : 503,
      latency_ms: latency,
      status,
      probe_type: 'readiness',
      details: {
        db: status === 'healthy' ? 'UP' : 'DOWN',
      },
    };
  }

  static generateAuditRecord(action = 'DEPLOYMENT_COMPLETED', actor = 'system', environment = 'kubernetes') {
    return {
      actor,
      action,
      target_type: 'environment',
      target_id: environment,
      environment,
      details: {
        timestamp: new Date().toISOString(),
        correlationId: crypto.randomUUID(),
      },
    };
  }
}
