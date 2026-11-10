/**
 * AdaptiveOps E2E Test Suite - Opaque-Box HTTP Client
 */

import crypto from 'node:crypto';

export class AdaptiveOpsClient {
  constructor(options = {}) {
    this.controlPlaneUrl = options.controlPlaneUrl || process.env.CONTROL_PLANE_URL || 'http://localhost:8787';
    this.orderServiceUrl = options.orderServiceUrl || process.env.ORDER_SERVICE_URL || 'http://localhost:8080';
    this.webhookSecret = options.webhookSecret || process.env.WEBHOOK_SECRET || 'adaptiveops-webhook-secret-key-test';
    this.adminApiKey = options.adminApiKey || process.env.ADMIN_API_KEY || 'adaptiveops-admin-api-key-test';
  }

  /**
   * Computes GitHub HMAC-SHA256 signature for given body string or buffer.
   */
  computeHmacSignature(body, secret = null) {
    const key = secret !== null ? secret : this.webhookSecret;
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(typeof body === 'string' ? body : JSON.stringify(body));
    return `sha256=${hmac.digest('hex')}`;
  }

  async _request(baseUrl, path, options = {}) {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = { 'Connection': 'close', ...options.headers };
    let body = options.body;

    if (body && typeof body === 'object' && !(body instanceof Buffer) && !(body instanceof Uint8Array)) {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      body = JSON.stringify(body);
    }

    const fetchOptions = {
      method: options.method || 'GET',
      headers,
      body,
    };

    const res = await fetch(url, fetchOptions);
    const contentType = res.headers.get('content-type') || '';
    let data = null;
    let rawText = '';

    try {
      rawText = await res.text();
      if (contentType.includes('application/json') || rawText.startsWith('{') || rawText.startsWith('[')) {
        data = JSON.parse(rawText);
      } else {
        data = rawText;
      }
    } catch {
      data = rawText;
    }

    return {
      status: res.status,
      statusCode: res.status,
      ok: res.ok,
      headers: res.headers,
      data,
      rawText,
    };
  }

  // ==========================================
  // Control Plane API Endpoints
  // ==========================================

  async sendWebhook(event, deliveryId, payload, options = {}) {
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    let signature = options.signature;
    if (signature === undefined) {
      const secret = options.secret !== undefined ? options.secret : this.webhookSecret;
      signature = this.computeHmacSignature(rawBody, secret);
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      ...(deliveryId !== null ? { 'X-GitHub-Delivery': deliveryId } : {}),
      ...(signature !== null ? { 'X-Hub-Signature-256': signature } : {}),
      ...options.headers,
    };

    return this._request(this.controlPlaneUrl, '/api/v1/webhooks/github', {
      method: 'POST',
      headers,
      body: rawBody,
    });
  }

  async getEnvironments() {
    return this._request(this.controlPlaneUrl, '/api/v1/environments');
  }

  async getEnvironmentStatus(name) {
    return this._request(this.controlPlaneUrl, `/api/v1/environments/${name}/status`);
  }

  async getReleases() {
    return this._request(this.controlPlaneUrl, '/api/v1/releases');
  }

  async getReleaseById(id) {
    return this._request(this.controlPlaneUrl, `/api/v1/releases/${id}`);
  }

  async postRelease(body) {
    return this._request(this.controlPlaneUrl, '/api/v1/releases', {
      method: 'POST',
      headers: { 'X-API-Key': this.adminApiKey },
      body,
    });
  }

  async getDeployments(params = {}) {
    const query = new URLSearchParams(params).toString();
    const path = `/api/v1/deployments${query ? `?${query}` : ''}`;
    return this._request(this.controlPlaneUrl, path);
  }

  async getDeploymentById(id) {
    return this._request(this.controlPlaneUrl, `/api/v1/deployments/${id}`);
  }

  async postDeployment(body) {
    return this._request(this.controlPlaneUrl, '/api/v1/deployments', {
      method: 'POST',
      headers: { 'X-API-Key': this.adminApiKey },
      body,
    });
  }

  async updateDeploymentStatus(id, status, details = {}) {
    return this._request(this.controlPlaneUrl, `/api/v1/deployments/${id}/status`, {
      method: 'PATCH',
      headers: { 'X-API-Key': this.adminApiKey },
      body: { status, ...details },
    });
  }

  async postHealthMetric(body) {
    return this._request(this.controlPlaneUrl, '/api/v1/health', {
      method: 'POST',
      headers: { 'X-API-Key': this.adminApiKey },
      body,
    });
  }

  async getHealthMetrics(environment) {
    return this._request(this.controlPlaneUrl, `/api/v1/health/${environment}`);
  }

  async getRollbackCandidates(environment) {
    return this._request(this.controlPlaneUrl, `/api/v1/rollback/candidates/${environment}`);
  }

  async executeRollback(body) {
    return this._request(this.controlPlaneUrl, '/api/v1/rollback', {
      method: 'POST',
      headers: { 'X-API-Key': this.adminApiKey },
      body,
    });
  }

  async getAuditLogs(params = {}) {
    const query = new URLSearchParams(params).toString();
    const path = `/api/v1/audit-logs${query ? `?${query}` : ''}`;
    return this._request(this.controlPlaneUrl, path);
  }

  async postAuditLog(body) {
    return this._request(this.controlPlaneUrl, '/api/v1/audit', {
      method: 'POST',
      headers: { 'X-API-Key': this.adminApiKey },
      body,
    });
  }

  // ==========================================
  // Order Service Backend Endpoints
  // ==========================================

  async createOrder(orderPayload, idempotencyKey = null, headers = {}) {
    const reqHeaders = { ...headers };
    if (idempotencyKey !== null) {
      reqHeaders['Idempotency-Key'] = idempotencyKey;
    }
    return this._request(this.orderServiceUrl, '/api/v1/orders', {
      method: 'POST',
      headers: reqHeaders,
      body: orderPayload,
    });
  }

  async getOrder(id) {
    return this._request(this.orderServiceUrl, `/api/v1/orders/${id}`);
  }

  async updateOrderStatus(id, status, version, ifMatch = null) {
    const headers = {};
    if (ifMatch !== null) {
      headers['If-Match'] = `"${ifMatch}"`;
    }
    return this._request(this.orderServiceUrl, `/api/v1/orders/${id}/status`, {
      method: 'PUT',
      headers,
      body: { status, version },
    });
  }

  async getLiveness() {
    return this._request(this.orderServiceUrl, '/actuator/health/liveness');
  }

  async getReadiness() {
    return this._request(this.orderServiceUrl, '/actuator/health/readiness');
  }

  async getPrometheusMetrics() {
    return this._request(this.orderServiceUrl, '/actuator/prometheus');
  }

  async getOpenApiSpec() {
    return this._request(this.orderServiceUrl, '/v3/api-docs');
  }
}
