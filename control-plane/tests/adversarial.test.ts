import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { computeGitHubSignature } from '../src/services/cryptoService';
import { setupTestDatabase } from './helpers';

describe('Milestone 1 Adversarial Challenge & Stress Suite', () => {
  const secret = 'adversarial-hmac-test-secret-key-32b';
  const adminKey = 'adm-secret-super-safe-key-9988';
  const testEnv = {
    ...env,
    GITHUB_WEBHOOK_SECRET: secret,
    ADMIN_API_KEY: adminKey
  };

  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });

  // =========================================================================
  // 1. HMAC Signature Forgery Challenge
  // =========================================================================
  describe('1. HMAC Signature Forgery Resistance', () => {
    it('strictly rejects forged HMAC with non-hex characters with 401 Unauthorized', async () => {
      const payload = JSON.stringify({ action: 'ping', test: 'non-hex' });
      const nonHexSignatures = [
        `sha256=${'g'.repeat(64)}`,
        `sha256=${'z'.repeat(64)}`,
        `sha256=${'x'.repeat(64)}`,
        `sha256=${'1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdeg'}`,
        `sha256=1234567890!@#$%^&*()_+-=1234567890abcdef1234567890abcdef12345678`
      ];

      for (const sig of nonHexSignatures) {
        const req = new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': `del-nonhex-${crypto.randomUUID().slice(0, 8)}`,
            'X-GitHub-Event': 'ping',
            'X-Hub-Signature-256': sig
          },
          body: payload
        });

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(401);
        const data: any = await res.json();
        expect(data.error).toBe('Unauthorized');
      }
    });

    it('strictly rejects invalid signature lengths (too short, too long, odd length) with 401', async () => {
      const payload = JSON.stringify({ action: 'ping', test: 'invalid-len' });
      const malformedSignatures = [
        'sha256=',                                  // 0 chars
        'sha256=abcdef',                            // 6 chars
        `sha256=${'a'.repeat(63)}`,                  // 63 chars (odd length, 1 char short)
        `sha256=${'a'.repeat(65)}`,                  // 65 chars (1 char too long)
        `sha256=${'a'.repeat(128)}`                  // 128 chars (SHA-512 length)
      ];

      for (const sig of malformedSignatures) {
        const req = new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': `del-len-${crypto.randomUUID().slice(0, 8)}`,
            'X-GitHub-Event': 'ping',
            'X-Hub-Signature-256': sig
          },
          body: payload
        });

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(401);
        const data: any = await res.json();
        expect(data.error).toBe('Unauthorized');
      }
    });

    it('strictly rejects empty or whitespace-only signatures with 401', async () => {
      const payload = JSON.stringify({ action: 'ping', test: 'empty-sig' });
      const emptyHeaders = ['', '   ', '\t\n', 'sha256=', 'sha256=   '];

      for (const sig of emptyHeaders) {
        const req = new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': `del-empty-${crypto.randomUUID().slice(0, 8)}`,
            'X-GitHub-Event': 'ping',
            'X-Hub-Signature-256': sig
          },
          body: payload
        });

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(401);
      }
    });

    it('handles uppercase hex digest flexibly while strictly rejecting uppercase prefix', async () => {
      const payload = JSON.stringify({ action: 'ping', test: 'casing' });
      const validSig = await computeGitHubSignature(secret, payload);
      const hexPart = validSig.replace('sha256=', '');

      // 1. Uppercase hex digest with standard prefix 'sha256=' (valid hex, different casing)
      const uppercaseHexSig = `sha256=${hexPart.toUpperCase()}`;
      const req1 = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': `del-casing-valid-${crypto.randomUUID().slice(0, 8)}`,
          'X-GitHub-Event': 'ping',
          'X-Hub-Signature-256': uppercaseHexSig
        },
        body: payload
      });
      const res1 = await app.fetch(req1, testEnv);
      expect(res1.status).toBe(200);

      // 2. Uppercase prefix 'SHA256=' -> must be strictly rejected with 401
      const uppercasePrefixSig = `SHA256=${hexPart}`;
      const req2 = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': `del-casing-prefix-${crypto.randomUUID().slice(0, 8)}`,
          'X-GitHub-Event': 'ping',
          'X-Hub-Signature-256': uppercasePrefixSig
        },
        body: payload
      });
      const res2 = await app.fetch(req2, testEnv);
      expect(res2.status).toBe(401);

      // 3. Mixed case prefix 'Sha256=' -> must be strictly rejected with 401
      const mixedPrefixSig = `Sha256=${hexPart}`;
      const req3 = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': `del-casing-mixed-${crypto.randomUUID().slice(0, 8)}`,
          'X-GitHub-Event': 'ping',
          'X-Hub-Signature-256': mixedPrefixSig
        },
        body: payload
      });
      const res3 = await app.fetch(req3, testEnv);
      expect(res3.status).toBe(401);
    });

    it('strictly rejects single-bit flips across first, middle, and last bytes with 401', async () => {
      const payload = JSON.stringify({
        deployment: {
          id: 501,
          sha: 'abcdef1234567890abcdef1234567890abcdef12',
          ref: 'refs/tags/v1.0.9',
          environment: 'kubernetes'
        }
      });
      const validSig = await computeGitHubSignature(secret, payload);
      const hexPart = validSig.replace('sha256=', '');

      // Helper to flip the lowest bit of character at index
      const flipCharAt = (hex: string, index: number) => {
        const char = hex[index];
        const val = parseInt(char, 16);
        const flippedVal = (val ^ 1).toString(16);
        return hex.substring(0, index) + flippedVal + hex.substring(index + 1);
      };

      const testIndices = [0, 1, 30, 31, 32, 62, 63]; // start, middle, and end positions
      for (const idx of testIndices) {
        const flippedHex = flipCharAt(hexPart, idx);
        const forgedSig = `sha256=${flippedHex}`;

        const req = new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': `del-flip-${idx}-${crypto.randomUUID().slice(0, 8)}`,
            'X-GitHub-Event': 'deployment',
            'X-Hub-Signature-256': forgedSig
          },
          body: payload
        });

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(401);
        const data: any = await res.json();
        expect(data.error).toBe('Unauthorized');
      }
    });

    it('rejects large payload (1MB) with forged signature with 401, accepts genuine with 200', async () => {
      // Create a 1MB payload
      const largeData = 'A'.repeat(1024 * 1024);
      const largePayload = JSON.stringify({ action: 'large-payload', data: largeData });

      // 1. Forged signature on 1MB payload
      const forgedSig = `sha256=${'0'.repeat(64)}`;
      const reqForged = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': `del-large-forged-${crypto.randomUUID().slice(0, 8)}`,
          'X-GitHub-Event': 'ping',
          'X-Hub-Signature-256': forgedSig
        },
        body: largePayload
      });
      const resForged = await app.fetch(reqForged, testEnv);
      expect(resForged.status).toBe(401);

      // 2. Genuine signature on 1MB payload
      const genuineSig = await computeGitHubSignature(secret, largePayload);
      const reqGenuine = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': `del-large-genuine-${crypto.randomUUID().slice(0, 8)}`,
          'X-GitHub-Event': 'ping',
          'X-Hub-Signature-256': genuineSig
        },
        body: largePayload
      });
      const resGenuine = await app.fetch(reqGenuine, testEnv);
      expect(resGenuine.status).toBe(200);
    });

    it('strictly rejects signatures generated with incorrect secret keys with 401', async () => {
      const payload = JSON.stringify({ action: 'ping', test: 'wrong-secret' });
      const attackerSecret = 'attacker-crafted-secret-key-999';
      const forgedSig = await computeGitHubSignature(attackerSecret, payload);

      const req = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': `del-wrong-sec-${crypto.randomUUID().slice(0, 8)}`,
          'X-GitHub-Event': 'ping',
          'X-Hub-Signature-256': forgedSig
        },
        body: payload
      });

      const res = await app.fetch(req, testEnv);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 2. Webhook Replay Attacks & Concurrent Race Conditions
  // =========================================================================
  describe('2. Webhook Replay Attacks & Concurrency Race Conditions', () => {
    it('rejects sequential replay attempts returning exact HTTP 202 already_processed', async () => {
      const deliveryId = `del-replay-seq-${crypto.randomUUID()}`;
      const payload = JSON.stringify({
        deployment: {
          id: 8801,
          sha: '1111222233334444555566667777888899990000',
          ref: 'refs/tags/v1.2.0',
          environment: 'kubernetes'
        }
      });
      const signature = await computeGitHubSignature(secret, payload);

      // 1st request -> Initial delivery: 200 OK
      const req1 = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': deliveryId,
          'X-GitHub-Event': 'deployment',
          'X-Hub-Signature-256': signature
        },
        body: payload
      });
      const res1 = await app.fetch(req1, testEnv);
      expect(res1.status).toBe(200);
      const data1: any = await res1.json();
      expect(data1.success).toBe(true);

      // 2nd request -> Immediate duplicate replay: 202 Accepted
      const req2 = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': deliveryId,
          'X-GitHub-Event': 'deployment',
          'X-Hub-Signature-256': signature
        },
        body: payload
      });
      const res2 = await app.fetch(req2, testEnv);
      expect(res2.status).toBe(202);
      const data2: any = await res2.json();
      expect(data2.status).toBe('already_processed');
      expect(data2.delivery_id).toBe(deliveryId);

      // 3rd request -> Subsequent duplicate replay: 202 Accepted
      const req3 = new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Delivery': deliveryId,
          'X-GitHub-Event': 'deployment',
          'X-Hub-Signature-256': signature
        },
        body: payload
      });
      const res3 = await app.fetch(req3, testEnv);
      expect(res3.status).toBe(202);

      // Verify DB contains exactly 1 delivery record and exactly 1 deployment
      const deliveryCount = await env.DB.prepare('SELECT COUNT(*) as count FROM webhook_deliveries WHERE delivery_id = ?')
        .bind(deliveryId)
        .first<{ count: number }>();
      expect(deliveryCount?.count).toBe(1);

      const depCount = await env.DB.prepare('SELECT COUNT(*) as count FROM deployments WHERE github_deployment_id = ?')
        .bind(8801)
        .first<{ count: number }>();
      expect(depCount?.count).toBe(1);
    });

    it('handles 20 concurrent duplicate deliveries atomically: exactly 1 success (200) and 19 duplicate rejections (202)', async () => {
      const concurrentDeliveryId = `del-race-concur-${crypto.randomUUID()}`;
      const ghDepId = 999901;
      const payload = JSON.stringify({
        deployment: {
          id: ghDepId,
          sha: 'fa01b02c03d04e05f06a07b08c09d01e02f03a04',
          ref: 'refs/tags/v1.9.9',
          environment: 'kubernetes',
          creator: { login: 'load-tester' }
        }
      });
      const signature = await computeGitHubSignature(secret, payload);

      // Fire 20 requests concurrently to stress test SQLite unique constraint race condition
      const requests = Array.from({ length: 20 }, () =>
        new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': concurrentDeliveryId,
            'X-GitHub-Event': 'deployment',
            'X-Hub-Signature-256': signature
          },
          body: payload
        })
      );

      const responses = await Promise.all(requests.map((r) => app.fetch(r, testEnv)));
      const statuses = responses.map((r) => r.status);

      const count200 = statuses.filter((s) => s === 200).length;
      const count202 = statuses.filter((s) => s === 202).length;
      const countOther = statuses.filter((s) => s !== 200 && s !== 202).length;

      // Assert zero internal server errors or crashes
      expect(countOther).toBe(0);
      // Assert exactly one thread claimed the delivery ID
      expect(count200).toBe(1);
      // Assert exactly 19 threads were deduplicated
      expect(count202).toBe(19);

      // Assert database integrity
      const deliveryRows = await env.DB.prepare('SELECT COUNT(*) as count FROM webhook_deliveries WHERE delivery_id = ?')
        .bind(concurrentDeliveryId)
        .first<{ count: number }>();
      expect(deliveryRows?.count).toBe(1);

      const deploymentRows = await env.DB.prepare('SELECT COUNT(*) as count FROM deployments WHERE github_deployment_id = ?')
        .bind(ghDepId)
        .first<{ count: number }>();
      expect(deploymentRows?.count).toBe(1);
    });

    it('rejects replay with altered payload: signature fails first (401) or replay rejected (202) without mutating data', async () => {
      const deliveryId = `del-replay-tamper-${crypto.randomUUID()}`;
      const payloadA = JSON.stringify({
        deployment: {
          id: 7701,
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ref: 'refs/tags/v1.0.0',
          environment: 'local'
        }
      });
      const sigA = await computeGitHubSignature(secret, payloadA);

      // 1. Initial valid delivery
      const res1 = await app.fetch(
        new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': deliveryId,
            'X-GitHub-Event': 'deployment',
            'X-Hub-Signature-256': sigA
          },
          body: payloadA
        }),
        testEnv
      );
      expect(res1.status).toBe(200);

      // 2. Attacker replays same delivery ID but with tampered payloadB and old signature -> 401
      const payloadB = JSON.stringify({
        deployment: {
          id: 7702,
          sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          ref: 'refs/tags/v2.0.0-pwned',
          environment: 'local'
        }
      });
      const resTamperedOldSig = await app.fetch(
        new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': deliveryId,
            'X-GitHub-Event': 'deployment',
            'X-Hub-Signature-256': sigA // old sig does not match payloadB
          },
          body: payloadB
        }),
        testEnv
      );
      expect(resTamperedOldSig.status).toBe(401);

      // 3. Attacker replays same delivery ID with payloadB and valid sigB -> 202 duplicate rejected
      const sigB = await computeGitHubSignature(secret, payloadB);
      const resTamperedValidSig = await app.fetch(
        new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': deliveryId,
            'X-GitHub-Event': 'deployment',
            'X-Hub-Signature-256': sigB
          },
          body: payloadB
        }),
        testEnv
      );
      expect(resTamperedValidSig.status).toBe(202);
      const body2: any = await resTamperedValidSig.json();
      expect(body2.status).toBe('already_processed');

      // Verify that malicious release v2.0.0-pwned was NEVER created
      const maliciousRel = await env.DB.prepare('SELECT * FROM releases WHERE version = ?')
        .bind('v2.0.0-pwned')
        .first();
      expect(maliciousRel).toBeNull();
    });
  });

  // =========================================================================
  // 3. SQL Injection Attempts
  // =========================================================================
  describe('3. SQL Injection Resilience (Delivery IDs & Environment Names)', () => {
    it('safely handles malicious SQL injection vectors in X-GitHub-Delivery without executing SQL', async () => {
      const sqlInjectionDeliveries = [
        `del-sqli-1'; DROP TABLE webhook_deliveries; --`,
        `del-sqli-2' OR '1'='1`,
        `del-sqli-3'; UPDATE environments SET target_version = 'pwned'; --`,
        `del-sqli-4' UNION SELECT 1, 2, 3, 4, 5, 6, 7; --`,
        `del-sqli-5" OR ""="`,
        `del-sqli-6\` OR \`1\`=\`1`,
        `del-sqli-7'; ATTACH DATABASE ':memory:' AS evil; --`
      ];

      for (let i = 0; i < sqlInjectionDeliveries.length; i++) {
        const sqliId = sqlInjectionDeliveries[i];
        const payload = JSON.stringify({ action: 'ping', test_idx: i });
        const signature = await computeGitHubSignature(secret, payload);

        const req = new Request('http://localhost/api/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': sqliId,
            'X-GitHub-Event': 'ping',
            'X-Hub-Signature-256': signature
          },
          body: payload
        });

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(200);

        // Replay same injection vector to ensure deduplication recognizes literal delivery_id
        const resReplay = await app.fetch(
          new Request('http://localhost/api/v1/webhooks/github', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-GitHub-Delivery': sqliId,
              'X-GitHub-Event': 'ping',
              'X-Hub-Signature-256': signature
            },
            body: payload
          }),
          testEnv
        );
        expect(resReplay.status).toBe(202);
      }

      // Verify webhook_deliveries table was NOT dropped and contains rows
      const tableCheck = await env.DB.prepare('SELECT COUNT(*) as count FROM webhook_deliveries').first<{ count: number }>();
      expect(tableCheck?.count).toBe(sqlInjectionDeliveries.length);

      // Verify environments table was NOT modified by injection vector 3
      const envCheck = await env.DB.prepare("SELECT COUNT(*) as count FROM environments WHERE target_version = 'pwned'").first<{ count: number }>();
      expect(envCheck?.count).toBe(0);
    });

    it('safely handles malicious SQL injection in environment names across REST endpoints', async () => {
      const sqlInjections = [
        `local' OR '1'='1`,
        `kubernetes'; DROP TABLE environments; --`,
        `local' UNION SELECT null, null, null, null, null, null, null, null, null, null, null--`,
        `local" OR ""="`,
        `' OR 1=1; --`
      ];

      for (const sqli of sqlInjections) {
        // 1. GET /api/v1/environments/:name/status
        const encodedName = encodeURIComponent(sqli);
        const resStatus = await app.fetch(
          new Request(`http://localhost/api/v1/environments/${encodedName}/status`, {
            method: 'GET'
          }),
          testEnv
        );
        expect(resStatus.status).toBe(404);

        // 2. GET /api/v1/health/:environment
        const resHealth = await app.fetch(
          new Request(`http://localhost/api/v1/health/${encodedName}`, {
            method: 'GET'
          }),
          testEnv
        );
        expect(resHealth.status).toBe(200);
        const healthData: any = await resHealth.json();
        expect(healthData.metrics).toEqual([]);

        // 3. GET /api/v1/rollback/candidates/:environment
        const resCandidates = await app.fetch(
          new Request(`http://localhost/api/v1/rollback/candidates/${encodedName}`, {
            method: 'GET'
          }),
          testEnv
        );
        expect(resCandidates.status).toBe(404);

        // 4. POST /api/v1/environments/:name/rollback
        const resRollback = await app.fetch(
          new Request(`http://localhost/api/v1/environments/${encodedName}/rollback`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': adminKey
            },
            body: JSON.stringify({ reason: 'testing sqli' })
          }),
          testEnv
        );
        expect(resRollback.status).toBe(400);

        // 5. Query parameters: GET /api/v1/deployments?environment=<sqli>
        const resDeployments = await app.fetch(
          new Request(`http://localhost/api/v1/deployments?environment=${encodedName}`, {
            method: 'GET'
          }),
          testEnv
        );
        expect(resDeployments.status).toBe(200);
        const depData: any = await resDeployments.json();
        expect(depData.deployments).toEqual([]);
        expect(depData.total).toBe(0);

        // 6. Query parameters: GET /api/v1/audit?environment=<sqli>
        const resAudit = await app.fetch(
          new Request(`http://localhost/api/v1/audit?environment=${encodedName}`, {
            method: 'GET'
          }),
          testEnv
        );
        expect(resAudit.status).toBe(200);
        const auditData: any = await resAudit.json();
        expect(auditData.audit_logs).toEqual([]);
        expect(auditData.total).toBe(0);
      }

      // Confirm environments table still has its initial 5 seeded environments intact
      const envs = await env.DB.prepare('SELECT COUNT(*) as count FROM environments').first<{ count: number }>();
      expect(envs?.count).toBe(5);
    });
  });

  // =========================================================================
  // 4. Administrative Security Gates & Boundaries
  // =========================================================================
  describe('4. Administrative Security Boundaries', () => {
    it('enforces admin authorization on rollback and health ingestion endpoints', async () => {
      // 1. Unauthenticated POST /api/v1/environments/kubernetes/rollback -> 401
      const resRollbackUnauth = await app.fetch(
        new Request('http://localhost/api/v1/environments/kubernetes/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'unauthorized rollback attempt' })
        }),
        testEnv
      );
      expect(resRollbackUnauth.status).toBe(401);

      // 2. Invalid API Key on rollback -> 401
      const resRollbackBadKey = await app.fetch(
        new Request('http://localhost/api/v1/environments/kubernetes/rollback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'completely-wrong-admin-key'
          },
          body: JSON.stringify({ reason: 'unauthorized rollback attempt' })
        }),
        testEnv
      );
      expect(resRollbackBadKey.status).toBe(401);

      // 3. Unauthenticated POST /api/v1/health -> 401
      const resHealthUnauth = await app.fetch(
        new Request('http://localhost/api/v1/health', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            environment: 'kubernetes',
            status: 'healthy',
            http_status: 200
          })
        }),
        testEnv
      );
      expect(resHealthUnauth.status).toBe(401);

      // 4. Authorized with Bearer token on health ingestion -> 200 OK
      const resHealthBearer = await app.fetch(
        new Request('http://localhost/api/v1/health', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminKey}`
          },
          body: JSON.stringify({
            environment: 'kubernetes',
            status: 'healthy',
            http_status: 200
          })
        }),
        testEnv
      );
      expect(resHealthBearer.status).toBe(200);
      const healthData: any = await resHealthBearer.json();
      expect(healthData.acknowledged).toBe(true);
    });
  });
});
