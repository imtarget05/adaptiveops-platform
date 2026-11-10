/**
 * AdaptiveOps E2E Test Suite - Embedded Contract Verification Server
 *
 * Provides a high-fidelity reference oracle and standalone emulator
 * implementing Cloudflare Workers Control Plane API and Spring Boot Order Service API
 * strictly according to PROJECT.md and ORIGINAL_REQUEST.md.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class ContractServer {
  constructor(options = {}) {
    this.controlPlanePort = options.controlPlanePort || 8787;
    this.orderServicePort = options.orderServicePort || 8080;
    this.webhookSecret = options.webhookSecret || 'adaptiveops-webhook-secret-key-test';
    this.adminApiKey = options.adminApiKey || 'adaptiveops-admin-api-key-test';
    this.db = new DatabaseSync(':memory:');
    this.cpServer = null;
    this.osServer = null;
    this._initDatabase();
  }

  _initDatabase() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE environments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        type TEXT NOT NULL,
        active_release_id TEXT,
        target_version TEXT,
        current_health_status TEXT NOT NULL DEFAULT 'unknown',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_health_check_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE releases (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL UNIQUE,
        commit_sha TEXT NOT NULL,
        branch TEXT,
        tag TEXT,
        git_author TEXT NOT NULL,
        commit_message TEXT,
        container_image_tag TEXT,
        metadata_json TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE deployments (
        id TEXT PRIMARY KEY,
        release_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        github_deployment_id INTEGER,
        status TEXT NOT NULL,
        strategy TEXT NOT NULL DEFAULT 'rolling',
        trigger_type TEXT NOT NULL,
        deployed_by TEXT NOT NULL,
        target_profile TEXT NOT NULL,
        config_snapshot_json TEXT,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT,
        rollback_deployment_id TEXT,
        FOREIGN KEY (release_id) REFERENCES releases(id),
        FOREIGN KEY (environment_id) REFERENCES environments(id)
      );

      CREATE TABLE deployment_events (
        id TEXT PRIMARY KEY,
        deployment_id TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (deployment_id) REFERENCES deployments(id)
      );

      CREATE TABLE health_metrics (
        id TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL,
        deployment_id TEXT,
        service_name TEXT NOT NULL,
        endpoint_url TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        probe_type TEXT NOT NULL,
        details_json TEXT,
        recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (environment_id) REFERENCES environments(id)
      );

      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        environment_id TEXT,
        details_json TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE webhook_deliveries (
        delivery_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        signature_verified INTEGER NOT NULL,
        payload_preview TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        total_amount REAL NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );

      CREATE TABLE idempotency_keys (
        key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_body TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE outbox_messages (
        id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at TIMESTAMP
      );
    `);

    // Seed Initial Environment & Release Data
    const insertEnv = this.db.prepare(`
      INSERT INTO environments (id, name, description, type, current_health_status)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertEnv.run('local', 'Local Docker Compose', 'Local dev compose stack', 'local', 'unknown');
    insertEnv.run('kubernetes', 'Kubernetes (kind)', 'Local/CI kind cluster', 'staging', 'unknown');
    insertEnv.run('cloudflare', 'Cloudflare Edge', 'Cloudflare Workers + D1', 'production', 'healthy');
    insertEnv.run('aws', 'AWS ECS Fargate', 'Amazon ECS target (dry-run ready)', 'cloud', 'unknown');
    insertEnv.run('azure', 'Azure Container Apps', 'Azure ACA target (dry-run ready)', 'cloud', 'unknown');

    // Seed v1.0.0 Release and successful initial deployment
    this.db.prepare(`
      INSERT INTO releases (id, version, commit_sha, branch, tag, git_author, commit_message, container_image_tag)
      VALUES ('rel-v1.0.0', 'v1.0.0', '9876543210fedcba9876543210fedcba98765432', 'main', 'v1.0.0', 'release-bot', 'Initial stable release v1.0.0', 'adaptiveops/order-service:v1.0.0')
    `).run();

    this.db.prepare(`
      INSERT INTO deployments (id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile, completed_at)
      VALUES ('dep-init-k8s', 'rel-v1.0.0', 'kubernetes', 'success', 'rolling', 'ci_cd', 'system', 'kubernetes', CURRENT_TIMESTAMP)
    `).run();

    this.db.prepare(`
      UPDATE environments SET active_release_id = 'rel-v1.0.0', target_version = 'v1.0.0', current_health_status = 'healthy' WHERE id = 'kubernetes'
    `).run();
  }

  _parseBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        const rawText = rawBuffer.toString('utf8');
        let parsed = null;
        try {
          if (rawText && (rawText.startsWith('{') || rawText.startsWith('['))) {
            parsed = JSON.parse(rawText);
          }
        } catch {
          // not json
        }
        resolve({ rawBuffer, rawText, parsed });
      });
      req.on('error', reject);
    });
  }

  _sendJson(res, statusCode, data, headers = {}) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery, X-API-Key, Idempotency-Key, If-Match, X-Trace-Id',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      ...headers,
    });
    res.end(JSON.stringify(data));
  }

  _sendError(res, statusCode, message, type = 'https://adaptiveops.io/errors/generic') {
    this._sendJson(res, statusCode, {
      type,
      title: statusCode >= 500 ? 'Internal Server Error' : 'Client Error',
      status: statusCode,
      detail: message,
      error: message,
    });
  }

  // ==========================================
  // Control Plane Server Handler
  // ==========================================
  async _handleControlPlane(req, res) {
    try {
      const { method, url } = req;
      const parsedUrl = new URL(url, `http://localhost:${this.controlPlanePort}`);
      const pathname = parsedUrl.pathname;

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery, X-API-Key, Idempotency-Key, If-Match, X-Trace-Id',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        });
        return res.end();
      }

      const { rawBuffer, rawText, parsed } = await this._parseBody(req);

      // 1. Webhook Ingestion: POST /api/v1/webhooks/github
      if (method === 'POST' && pathname === '/api/v1/webhooks/github') {
        const sigHeader = req.headers['x-hub-signature-256'];
        const eventHeader = req.headers['x-github-event'];
        const deliveryId = req.headers['x-github-delivery'];

        if (!eventHeader || !deliveryId) {
          return this._sendError(res, 400, 'Missing required webhook headers (X-GitHub-Event or X-GitHub-Delivery)');
        }

        if (!sigHeader) {
          return this._sendError(res, 400, 'Missing X-Hub-Signature-256 header');
        }

        if (!sigHeader.startsWith('sha256=') || sigHeader.length !== 71) {
          return this._sendError(res, 401, 'Malformed X-Hub-Signature-256 header');
        }

        const expectedSig = `sha256=${crypto.createHmac('sha256', this.webhookSecret).update(rawBuffer).digest('hex')}`;
        const sigBuffer = Buffer.from(sigHeader);
        const expectedBuffer = Buffer.from(expectedSig);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          return this._sendError(res, 401, 'Invalid HMAC signature');
        }

        // Check deduplication
        const existing = this.db.prepare('SELECT delivery_id FROM webhook_deliveries WHERE delivery_id = ?').get(deliveryId);
        if (existing) {
          return this._sendJson(res, 202, {
            status: 'already_processed',
            delivery_id: deliveryId,
            message: 'Delivery ID already processed. Duplicate skipped.',
          });
        }

        // Record delivery
        this.db.prepare(`
          INSERT INTO webhook_deliveries (delivery_id, event_type, signature_verified, payload_preview, status)
          VALUES (?, ?, 1, ?, 'processed')
        `).run(deliveryId, eventHeader, rawText.slice(0, 100));

        // Handle deployment / deployment_status event
        if (eventHeader === 'deployment' && parsed) {
          const depId = `dep-${parsed.deployment?.id ? `${parsed.deployment.id}-${crypto.randomUUID().slice(0, 6)}` : crypto.randomUUID().slice(0, 8)}`;
          const relVersion = parsed.deployment?.ref || parsed.deployment?.sha?.slice(0, 7) || 'v1.0.0';
          const envName = parsed.deployment?.environment || 'kubernetes';

        let rel = this.db.prepare('SELECT id FROM releases WHERE version = ?').get(relVersion);
        if (!rel) {
          const relId = `rel-${relVersion}`;
          this.db.prepare(`
            INSERT INTO releases (id, version, commit_sha, git_author, commit_message)
            VALUES (?, ?, ?, ?, ?)
          `).run(relId, relVersion, parsed.deployment?.sha || 'unknown', parsed.deployment?.creator?.login || 'github', 'Auto-created from webhook');
          rel = { id: relId };
        }

        this.db.prepare(`
          INSERT INTO deployments (id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile)
          VALUES (?, ?, ?, 'in_progress', 'rolling', 'webhook', ?, ?)
        `).run(depId, rel.id, envName, parsed.deployment?.creator?.login || 'github', envName);

        return this._sendJson(res, 201, { success: true, delivery_id: deliveryId, deployment_id: depId, status: 'in_progress' });
      }

      return this._sendJson(res, 200, { success: true, delivery_id: deliveryId, event: eventHeader });
    }

    // 2. Environments: GET /api/v1/environments
    if (method === 'GET' && pathname === '/api/v1/environments') {
      const rows = this.db.prepare('SELECT * FROM environments').all();
      return this._sendJson(res, 200, rows);
    }

    // GET /api/v1/environments/:name/status
    if (method === 'GET' && pathname.startsWith('/api/v1/environments/') && pathname.endsWith('/status')) {
      const name = pathname.split('/')[4];
      const env = this.db.prepare('SELECT * FROM environments WHERE id = ? OR name = ?').get(name, name);
      if (!env) return this._sendError(res, 404, `Environment ${name} not found`);
      const recentDeployments = this.db.prepare('SELECT * FROM deployments WHERE environment_id = ? ORDER BY started_at DESC LIMIT 5').all(env.id);
      const recentHealth = this.db.prepare('SELECT * FROM health_metrics WHERE environment_id = ? ORDER BY recorded_at DESC LIMIT 5').all(env.id);
      return this._sendJson(res, 200, { environment: env, deployments: recentDeployments, health: recentHealth });
    }

    // 3. Releases: GET /api/v1/releases
    if (method === 'GET' && pathname === '/api/v1/releases') {
      const rows = this.db.prepare('SELECT * FROM releases ORDER BY created_at DESC').all();
      return this._sendJson(res, 200, rows);
    }

    // POST /api/v1/releases
    if (method === 'POST' && pathname === '/api/v1/releases') {
      if (!parsed || !parsed.version || !parsed.commit_sha) {
        return this._sendError(res, 400, 'version and commit_sha are required');
      }
      const existing = this.db.prepare('SELECT id FROM releases WHERE version = ?').get(parsed.version);
      if (existing) {
        return this._sendError(res, 409, `Release version ${parsed.version} already exists`);
      }
      const id = parsed.id || `rel-${parsed.version}`;
      this.db.prepare(`
        INSERT INTO releases (id, version, commit_sha, branch, tag, git_author, commit_message, container_image_tag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.version,
        parsed.commit_sha,
        parsed.branch || 'main',
        parsed.tag || parsed.version,
        parsed.git_author || 'system',
        parsed.commit_message || '',
        parsed.container_image_tag || `adaptiveops/order-service:${parsed.version}`
      );
      return this._sendJson(res, 201, { id, version: parsed.version });
    }

    // GET /api/v1/releases/:id
    if (method === 'GET' && pathname.startsWith('/api/v1/releases/')) {
      const id = pathname.split('/')[4];
      const rel = this.db.prepare('SELECT * FROM releases WHERE id = ? OR version = ?').get(id, id);
      if (!rel) return this._sendError(res, 404, `Release ${id} not found`);
      return this._sendJson(res, 200, rel);
    }

    // 4. Deployments: GET /api/v1/deployments
    if (method === 'GET' && pathname === '/api/v1/deployments') {
      const envFilter = parsedUrl.searchParams.get('environment');
      const statusFilter = parsedUrl.searchParams.get('status');
      let query = 'SELECT * FROM deployments WHERE 1=1';
      const params = [];
      if (envFilter) { query += ' AND environment_id = ?'; params.push(envFilter); }
      if (statusFilter) { query += ' AND status = ?'; params.push(statusFilter); }
      query += ' ORDER BY started_at DESC LIMIT 50';
      const rows = this.db.prepare(query).all(...params);
      return this._sendJson(res, 200, rows);
    }

    // GET /api/v1/deployments/:id
    if (method === 'GET' && pathname.startsWith('/api/v1/deployments/')) {
      const depId = pathname.split('/')[4];
      const dep = this.db.prepare('SELECT * FROM deployments WHERE id = ?').get(depId);
      if (!dep) return this._sendError(res, 404, `Deployment ${depId} not found`);
      return this._sendJson(res, 200, dep);
    }

    // POST /api/v1/deployments
    if (method === 'POST' && pathname === '/api/v1/deployments') {
      if (!parsed || !parsed.release_id || !parsed.environment_id) {
        return this._sendError(res, 400, 'release_id and environment_id are required');
      }
      const depId = parsed.id || `dep-${crypto.randomUUID().slice(0, 8)}`;
      this.db.prepare(`
        INSERT INTO deployments (id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        depId,
        parsed.release_id,
        parsed.environment_id,
        parsed.status || 'in_progress',
        parsed.strategy || 'rolling',
        parsed.trigger_type || 'ci_cd',
        parsed.deployed_by || 'system',
        parsed.target_profile || parsed.environment_id
      );
      return this._sendJson(res, 201, { id: depId, status: parsed.status || 'in_progress' });
    }

    // PATCH /api/v1/deployments/:id/status
    if (method === 'PATCH' && pathname.startsWith('/api/v1/deployments/') && pathname.endsWith('/status')) {
      const depId = pathname.split('/')[4];
      const dep = this.db.prepare('SELECT * FROM deployments WHERE id = ?').get(depId);
      if (!dep) return this._sendError(res, 404, `Deployment ${depId} not found`);

      const newStatus = parsed?.status;
      if (!newStatus) return this._sendError(res, 400, 'status is required');

      this.db.prepare(`
        UPDATE deployments 
        SET status = ?, completed_at = CURRENT_TIMESTAMP, error_message = ?
        WHERE id = ?
      `).run(newStatus, parsed.error_message || null, depId);

      if (newStatus === 'success') {
        this.db.prepare(`
          UPDATE environments SET active_release_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(dep.release_id, dep.environment_id);
      }

      return this._sendJson(res, 200, { id: depId, status: newStatus });
    }

    // 5. Health: POST /api/v1/health
    if (method === 'POST' && pathname === '/api/v1/health') {
      if (!parsed || !parsed.environment || parsed.http_status === undefined) {
        return this._sendError(res, 400, 'environment and http_status are required');
      }
      const metricId = `met-${crypto.randomUUID().slice(0, 8)}`;
      const status = parsed.status || (parsed.http_status === 200 ? 'healthy' : 'unhealthy');
      const latency = parsed.latency_ms || 40;

      this.db.prepare(`
        INSERT INTO health_metrics (id, environment_id, service_name, endpoint_url, http_status, latency_ms, status, probe_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        metricId,
        parsed.environment,
        parsed.service_name || 'order-service',
        parsed.endpoint_url || 'http://localhost:8080/actuator/health',
        parsed.http_status,
        latency,
        status,
        parsed.probe_type || 'readiness'
      );

      // Evaluate sliding window of last 5 probes
      const recent = this.db.prepare(`
        SELECT status, latency_ms, http_status FROM health_metrics
        WHERE environment_id = ? ORDER BY rowid DESC LIMIT 5
      `).all(parsed.environment);

      let consecutiveFailures = 0;
      for (const p of recent) {
        if (p.status === 'unhealthy' || p.http_status !== 200) consecutiveFailures++;
        else break;
      }

      let envStatus = 'healthy';
      if (consecutiveFailures >= 3) {
        envStatus = 'unhealthy';
      } else if (consecutiveFailures >= 1 || recent.some(p => p.latency_ms > 1500) || recent.some(p => p.status === 'degraded')) {
        envStatus = 'degraded';
      }

      this.db.prepare(`
        UPDATE environments 
        SET current_health_status = ?, consecutive_failures = ?, last_health_check_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(envStatus, consecutiveFailures, parsed.environment);

      return this._sendJson(res, 200, { acknowledged: true, metric_id: metricId, environment_status: envStatus, consecutive_failures: consecutiveFailures });
    }

    // GET /api/v1/health/:environment
    if (method === 'GET' && pathname.startsWith('/api/v1/health/')) {
      const env = pathname.split('/')[4];
      const metrics = this.db.prepare('SELECT * FROM health_metrics WHERE environment_id = ? ORDER BY recorded_at DESC LIMIT 20').all(env);
      return this._sendJson(res, 200, metrics);
    }

    // 6. Rollback: GET /api/v1/rollback/candidates/:environment
    if (method === 'GET' && pathname.startsWith('/api/v1/rollback/candidates/')) {
      const envId = pathname.split('/')[5];
      const env = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(envId);
      if (!env) return this._sendError(res, 404, `Environment ${envId} not found`);

      // Find last successful deployment for a DIFFERENT release than current active
      const candidate = this.db.prepare(`
        SELECT d.id AS previous_deployment_id, d.release_id, r.version, r.commit_sha, r.container_image_tag, d.completed_at AS last_healthy_at
        FROM deployments d
        JOIN releases r ON d.release_id = r.id
        WHERE d.environment_id = ? AND d.status = 'success' AND d.release_id != COALESCE(?, '')
        ORDER BY d.rowid DESC LIMIT 1
      `).get(envId, env.active_release_id || '');

      return this._sendJson(res, 200, {
        environment: envId,
        current_release_id: env.active_release_id,
        candidate_release: candidate || null,
      });
    }

    // POST /api/v1/rollback
    if (method === 'POST' && pathname === '/api/v1/rollback') {
      const envId = parsed?.environment;
      if (!envId) return this._sendError(res, 400, 'environment is required');

      const env = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(envId);
      if (!env) return this._sendError(res, 404, `Environment ${envId} not found`);

      let targetReleaseId = parsed.target_release_id;
      if (!targetReleaseId) {
        const candidate = this.db.prepare(`
          SELECT release_id FROM deployments
          WHERE environment_id = ? AND status = 'success' AND release_id != COALESCE(?, '')
          ORDER BY rowid DESC LIMIT 1
        `).get(envId, env.active_release_id || '');
        if (!candidate) {
          return this._sendError(res, 422, 'No valid rollback candidate available');
        }
        targetReleaseId = candidate.release_id;
      }

      const targetRelease = this.db.prepare('SELECT * FROM releases WHERE id = ? OR version = ?').get(targetReleaseId, targetReleaseId);
      if (!targetRelease) return this._sendError(res, 404, 'Target release not found');

      const rollbackId = `rb-${crypto.randomUUID().slice(0, 8)}`;
      const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
      const depId = `dep-${crypto.randomUUID().slice(0, 8)}`;

      // Atomic batch
      this.db.prepare(`UPDATE deployments SET status = 'rolled_back' WHERE environment_id = ? AND status IN ('in_progress', 'failure')`).run(envId);
      this.db.prepare(`
        INSERT INTO deployments (id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile)
        VALUES (?, ?, ?, 'in_progress', 'rolling', 'rollback', ?, ?)
      `).run(depId, targetRelease.id, envId, parsed.triggered_by || 'system', envId);

      this.db.prepare(`
        UPDATE environments 
        SET target_version = ?, current_health_status = 'degraded', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(targetRelease.version, envId);

      this.db.prepare(`
        INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json)
        VALUES (?, ?, 'ROLLBACK_TRIGGERED', 'environment', ?, ?, ?)
      `).run(
        auditId,
        parsed.triggered_by || 'auto-rollback-daemon',
        envId,
        envId,
        JSON.stringify({ rollbackId, targetVersion: targetRelease.version, reason: parsed.reason || 'Automated rollback' })
      );

      return this._sendJson(res, 200, {
        rollback_id: rollbackId,
        deployment_id: depId,
        target_version: targetRelease.version,
        status: 'initiated',
        audit_log_id: auditId,
      });
    }

    // 7. Audit: GET /api/v1/audit-logs
    if (method === 'GET' && (pathname === '/api/v1/audit-logs' || pathname === '/api/v1/audit')) {
      const logs = this.db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50').all();
      return this._sendJson(res, 200, logs);
    }

    // POST /api/v1/audit
    if (method === 'POST' && (pathname === '/api/v1/audit-logs' || pathname === '/api/v1/audit')) {
      if (!parsed || !parsed.action) return this._sendError(res, 400, 'action is required');
      const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
      this.db.prepare(`
        INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditId,
        parsed.actor || 'system',
        parsed.action,
        parsed.target_type || 'system',
        parsed.target_id || 'system',
        parsed.environment || null,
        JSON.stringify(parsed.details || {})
      );
      return this._sendJson(res, 201, { audit_id: auditId, recorded_at: new Date().toISOString() });
    }

    // Immutability protection: PUT / PATCH / DELETE on audit logs
    if (['PUT', 'PATCH', 'DELETE'].includes(method) && (pathname.startsWith('/api/v1/audit-logs') || pathname.startsWith('/api/v1/audit'))) {
      res.writeHead(405, { 'Allow': 'GET, POST' });
      return res.end(JSON.stringify({ error: 'Audit logs are immutable' }));
    }

    // 404 for unknown endpoints
    return this._sendError(res, 404, `Endpoint ${method} ${pathname} not found`);
    } catch (err) {
      return this._sendError(res, 500, err.message);
    }
  }

  // ==========================================
  // Order Service Handler
  // ==========================================
  async _handleOrderService(req, res) {
    try {
      const { method, url } = req;
      const parsedUrl = new URL(url, `http://localhost:${this.orderServicePort}`);
      const pathname = parsedUrl.pathname;

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, If-Match, X-Trace-Id',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      return res.end();
    }

    const { rawText, parsed } = await this._parseBody(req);

    // Actuator Probes
    if (method === 'GET' && pathname === '/actuator/health/liveness') {
      return this._sendJson(res, 200, { status: 'UP' });
    }
    if (method === 'GET' && pathname === '/actuator/health/readiness') {
      return this._sendJson(res, 200, { status: 'UP' });
    }
    if (method === 'GET' && pathname === '/actuator/prometheus') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      return res.end('# HELP jvm_memory_used_bytes The amount of used memory\n# TYPE jvm_memory_used_bytes gauge\njvm_memory_used_bytes{area="heap"} 67108864.0\n');
    }
    if (method === 'GET' && pathname === '/v3/api-docs') {
      return this._sendJson(res, 200, {
        openapi: '3.0.3',
        info: { title: 'AdaptiveOps Order Service API', version: '1.0.0' },
        paths: {
          '/api/v1/orders': { post: { summary: 'Create order' } },
          '/api/v1/orders/{id}/status': { put: { summary: 'Update order status' } }
        }
      });
    }

    // 1. Create Order: POST /api/v1/orders
    if (method === 'POST' && pathname === '/api/v1/orders') {
      const idempotencyKey = req.headers['idempotency-key'];
      if (!idempotencyKey) {
        return this._sendError(res, 400, 'Idempotency-Key header is required');
      }

      if (!parsed || !parsed.customerId || !parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        return this._sendError(res, 400, 'Invalid order payload: customerId and non-empty items array required');
      }

      if (parsed.totalAmount !== undefined && parsed.totalAmount <= 0) {
        return this._sendError(res, 400, 'totalAmount must be greater than zero');
      }

      for (const it of parsed.items) {
        if (!it.sku || it.quantity === undefined || it.quantity <= 0 || it.unitPrice === undefined || it.unitPrice < 0) {
          return this._sendError(res, 400, 'Invalid order item: sku, quantity > 0, unitPrice >= 0 required');
        }
      }

      // Check Idempotency Key
      const payloadHash = crypto.createHash('sha256').update(rawText.trim()).digest('hex');
      const existingIdem = this.db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(idempotencyKey);

      if (existingIdem) {
        if (existingIdem.request_hash !== payloadHash) {
          return this._sendError(
            res,
            409,
            `Idempotency-Key "${idempotencyKey}" already used with different payload`,
            'https://adaptiveops.io/errors/idempotency-conflict'
          );
        }
        // Return cached response
        return this._sendJson(res, existingIdem.response_status, JSON.parse(existingIdem.response_body));
      }

      const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
      const total = parsed.totalAmount || parsed.items.reduce((sum, i) => sum + (i.quantity * i.unitPrice), 0);

      this.db.prepare(`
        INSERT INTO orders (id, customer_id, total_amount, status, version)
        VALUES (?, ?, ?, 'CREATED', 0)
      `).run(orderId, parsed.customerId, total);

      for (const item of parsed.items) {
        this.db.prepare(`
          INSERT INTO order_items (id, order_id, sku, quantity, unit_price)
          VALUES (?, ?, ?, ?, ?)
        `).run(`item-${crypto.randomUUID().slice(0, 8)}`, orderId, item.sku, item.quantity, item.unitPrice);
      }

      // Outbox event
      this.db.prepare(`
        INSERT INTO outbox_messages (id, aggregate_type, aggregate_id, event_type, payload, status)
        VALUES (?, 'Order', ?, 'OrderCreated', ?, 'PENDING')
      `).run(`out-${crypto.randomUUID().slice(0, 8)}`, orderId, JSON.stringify({ orderId, customerId: parsed.customerId, total }));

      const responseBody = {
        id: orderId,
        customerId: parsed.customerId,
        totalAmount: total,
        status: 'CREATED',
        version: 0,
        items: parsed.items,
        createdAt: new Date().toISOString(),
      };

      this.db.prepare(`
        INSERT INTO idempotency_keys (key, request_hash, response_status, response_body)
        VALUES (?, ?, 201, ?)
      `).run(idempotencyKey, payloadHash, JSON.stringify(responseBody));

      return this._sendJson(res, 201, responseBody);
    }

    // 2. Get Order: GET /api/v1/orders/:id
    if (method === 'GET' && pathname.startsWith('/api/v1/orders/')) {
      const id = pathname.split('/')[4];
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) return this._sendError(res, 404, `Order ${id} not found`);
      const items = this.db.prepare('SELECT sku, quantity, unit_price AS unitPrice FROM order_items WHERE order_id = ?').all(id);
      return this._sendJson(res, 200, {
        id: order.id,
        customerId: order.customer_id,
        totalAmount: order.total_amount,
        status: order.status,
        version: order.version,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        items,
      });
    }

    // 3. Update Order Status: PUT /api/v1/orders/:id/status
    if (method === 'PUT' && pathname.startsWith('/api/v1/orders/') && pathname.endsWith('/status')) {
      const id = pathname.split('/')[4];
      const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) return this._sendError(res, 404, `Order ${id} not found`);

      // Determine requested version from If-Match or body
      let reqVersion = parsed?.version;
      const ifMatch = req.headers['if-match'];
      if (ifMatch) {
        reqVersion = parseInt(ifMatch.replace(/"/g, ''), 10);
      }

      if (reqVersion === undefined || isNaN(reqVersion)) {
        return this._sendError(res, 400, 'Version or If-Match header is required');
      }

      // Optimistic Locking Check
      if (order.version !== reqVersion) {
        return this._sendJson(res, 409, {
          type: 'https://adaptiveops.io/errors/conflict',
          title: 'Optimistic Lock Failure',
          status: 409,
          detail: `Version collision: current order version is ${order.version}, but request specified ${reqVersion}`,
          expectedVersion: order.version,
          actualVersion: reqVersion,
        });
      }

      const targetStatus = parsed?.status;
      if (!targetStatus) return this._sendError(res, 400, 'status is required');

      // Finite State Machine (FSM) Invariants
      const validTransitions = {
        'CREATED': ['PENDING', 'CANCELLED'],
        'PENDING': ['APPROVED', 'CANCELLED'],
        'APPROVED': ['COMPLETED', 'CANCELLED'],
        'COMPLETED': [],
        'CANCELLED': [],
      };

      const allowed = validTransitions[order.status] || [];
      if (!allowed.includes(targetStatus)) {
        return this._sendError(
          res,
          422,
          `Invalid state transition: cannot transition order from ${order.status} to ${targetStatus}`,
          'https://adaptiveops.io/errors/invalid-transition'
        );
      }

      const nextVersion = order.version + 1;
      this.db.prepare(`
        UPDATE orders SET status = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(targetStatus, nextVersion, id);

      // Outbox Message
      this.db.prepare(`
        INSERT INTO outbox_messages (id, aggregate_type, aggregate_id, event_type, payload, status)
        VALUES (?, 'Order', ?, 'OrderStatusChanged', ?, 'PENDING')
      `).run(`out-${crypto.randomUUID().slice(0, 8)}`, id, JSON.stringify({ orderId: id, previousStatus: order.status, status: targetStatus, version: nextVersion }));

      const updated = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      return this._sendJson(res, 200, {
        id: updated.id,
        customerId: updated.customer_id,
        totalAmount: updated.total_amount,
        status: updated.status,
        version: updated.version,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      });
    }

    return this._sendError(res, 404, `Endpoint ${method} ${pathname} not found`);
    } catch (err) {
      return this._sendError(res, 500, err.message);
    }
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.cpServer = http.createServer((req, res) => this._handleControlPlane(req, res));
      this.osServer = http.createServer((req, res) => this._handleOrderService(req, res));

      this.cpServer.listen(this.controlPlanePort, () => {
        this.osServer.listen(this.orderServicePort, () => {
          resolve({
            controlPlaneUrl: `http://localhost:${this.controlPlanePort}`,
            orderServiceUrl: `http://localhost:${this.orderServicePort}`,
          });
        });
      });

      this.cpServer.on('error', reject);
      this.osServer.on('error', reject);
    });
  }

  async stop() {
    return new Promise(resolve => {
      let closed = 0;
      const checkDone = () => {
        closed++;
        if (closed >= 2) resolve();
      };
      if (this.cpServer) this.cpServer.close(checkDone); else checkDone();
      if (this.osServer) this.osServer.close(checkDone); else checkDone();
    });
  }
}
