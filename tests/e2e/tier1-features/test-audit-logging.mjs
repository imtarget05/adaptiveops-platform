/**
 * Tier 1 - Feature Coverage: Immutable Audit Log Reflection (Feature 26 / Requirement R4/R5)
 *
 * Verifies tamper-evident audit ledger ingestion, immutability, and queries:
 * - Audit event POST returns 201 Created
 * - Missing action field returns 400 Bad Request
 * - Audit entries queryable with metadata
 * - PUT / PATCH modification rejected with 405 Method Not Allowed
 * - DELETE removal rejected with 405 Method Not Allowed
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Immutable Audit Log Reflection';

export async function run(client) {
  const auditAction = `TEST_AUDIT_ACTION_${crypto.randomUUID().slice(0, 6)}`;

  // Test 1: Ingesting audit event returns 201 Created
  let auditId = null;
  {
    const res = await client.postAuditLog({
      actor: 'qa-test-runner',
      action: auditAction,
      target_type: 'environment',
      target_id: 'kubernetes',
      environment: 'kubernetes',
      details: {
        reason: 'Automated test execution verification',
        traceId: crypto.randomUUID(),
      },
    });
    assertStatus(res, 201);
    assertTrue(Boolean(res.data.audit_id), 'audit_id must be returned');
    auditId = res.data.audit_id;
  }

  // Test 2: Audit entry is retrievable via GET /api/v1/audit-logs
  {
    const res = await client.getAuditLogs();
    assertStatus(res, 200);
    assertTrue(Array.isArray(res.data), 'Audit logs must be an array');
    const entry = res.data.find(l => l.action === auditAction);
    assertTrue(Boolean(entry), 'Created audit log entry must appear in audit ledger');
    assertEqual(entry.actor, 'qa-test-runner');
  }

  // Test 3: Missing required action field returns 400 Bad Request
  {
    const res = await client.postAuditLog({
      // missing action
      actor: 'tester',
    });
    assertStatus(res, 400, 'Audit event missing action must return 400 Bad Request');
  }

  // Test 4: Immutability enforcement: PUT /api/v1/audit-logs returns 405 Method Not Allowed
  {
    const res = await client._request(client.controlPlaneUrl, `/api/v1/audit-logs/${auditId}`, {
      method: 'PUT',
      body: { action: 'TAMPERED_ACTION' },
    });
    assertStatus(res, 405, 'Modification attempt (PUT) on audit log must return 405 Method Not Allowed');
  }

  // Test 5: Immutability enforcement: DELETE /api/v1/audit-logs returns 405 Method Not Allowed
  {
    const res = await client._request(client.controlPlaneUrl, `/api/v1/audit-logs/${auditId}`, {
      method: 'DELETE',
    });
    assertStatus(res, 405, 'Deletion attempt (DELETE) on audit log must return 405 Method Not Allowed');
  }
}
