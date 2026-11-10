/**
 * Empirical Adversarial Test Harness for Milestone 1 (Control Plane API & Dashboard)
 * Executed by challenger_m1_2 against local runtime at http://127.0.0.1:8787
 */

const BASE_URL = process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:8787';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-admin-api-key';
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || 'dev-webhook-secret';

import crypto from 'node:crypto';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': ADMIN_API_KEY,
    ...(options.headers || {})
  };
  let body = options.body;
  if (body && typeof body === 'object') {
    body = JSON.stringify(body);
  }
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body
  });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data, text };
}

function computeHmac(secret, payload) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

const results = [];

function record(testName, passed, details) {
  results.push({ testName, passed, details });
  const mark = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${mark}: ${testName}`);
  if (details) {
    console.log(`   Details:`, JSON.stringify(details));
  }
}

async function runEmpiricalTests() {
  console.log(`\n======================================================`);
  console.log(`Starting Empirical Adversarial Verification on ${BASE_URL}`);
  console.log(`======================================================\n`);

  // ------------------------------------------------------------------------
  // PART 1: Health Threshold Boundaries
  // ------------------------------------------------------------------------
  console.log(`--- [PART 1: Health Threshold Boundaries] ---`);
  const healthEnv = 'kubernetes';

  // 1.0 Reset to healthy baseline (5 consecutive healthy probes)
  for (let i = 0; i < 5; i++) {
    await request('/api/v1/health', {
      method: 'POST',
      body: {
        environment: healthEnv,
        service_name: 'order-service',
        http_status: 200,
        latency_ms: 30,
        status: 'healthy',
        probe_type: 'readiness'
      }
    });
  }
  const baselineEnv = await request(`/api/v1/environments/${healthEnv}/status`);
  const baselineStatus = baselineEnv.data.environment?.current_health_status;
  const baselineFailures = baselineEnv.data.environment?.consecutive_failures;
  record(
    '1.0 Baseline health initialization',
    baselineStatus === 'healthy' && baselineFailures === 0,
    { baselineStatus, baselineFailures }
  );

  // 1.1 Exactly 1 failure -> Expect 'degraded'
  const fail1 = await request('/api/v1/health', {
    method: 'POST',
    body: {
      environment: healthEnv,
      service_name: 'order-service',
      http_status: 500,
      latency_ms: 50,
      status: 'unhealthy',
      probe_type: 'readiness'
    }
  });
  const envAfter1 = await request(`/api/v1/environments/${healthEnv}/status`);
  const status1 = envAfter1.data.environment?.current_health_status;
  const consec1 = envAfter1.data.environment?.consecutive_failures;
  record(
    '1.1 Exactly 1 failure -> degraded',
    fail1.status === 200 && status1 === 'degraded' && consec1 === 1,
    { status: status1, consecutive_failures: consec1, apiAcknowledged: fail1.data?.environment_status }
  );

  // 1.2 Exactly 2 failures -> Expect 'degraded' (NOT unhealthy)
  const fail2 = await request('/api/v1/health', {
    method: 'POST',
    body: {
      environment: healthEnv,
      service_name: 'order-service',
      http_status: 503,
      latency_ms: 60,
      status: 'unhealthy',
      probe_type: 'readiness'
    }
  });
  const envAfter2 = await request(`/api/v1/environments/${healthEnv}/status`);
  const status2 = envAfter2.data.environment?.current_health_status;
  const consec2 = envAfter2.data.environment?.consecutive_failures;
  record(
    '1.2 Exactly 2 failures -> remains degraded',
    fail2.status === 200 && status2 === 'degraded' && consec2 === 2,
    { status: status2, consecutive_failures: consec2, apiAcknowledged: fail2.data?.environment_status }
  );

  // 1.3 Exactly 3 failures -> Expect 'unhealthy' threshold breach
  const fail3 = await request('/api/v1/health', {
    method: 'POST',
    body: {
      environment: healthEnv,
      service_name: 'order-service',
      http_status: 500,
      latency_ms: 80,
      status: 'unhealthy',
      probe_type: 'readiness'
    }
  });
  const envAfter3 = await request(`/api/v1/environments/${healthEnv}/status`);
  const status3 = envAfter3.data.environment?.current_health_status;
  const consec3 = envAfter3.data.environment?.consecutive_failures;
  record(
    '1.3 Exactly 3 failures -> trips to unhealthy',
    fail3.status === 200 && status3 === 'unhealthy' && consec3 === 3,
    { status: status3, consecutive_failures: consec3, apiAcknowledged: fail3.data?.environment_status }
  );

  // 1.4 Flapping Probe: 1 healthy probe after consecutive failures
  // Expect consecutive_failures resets to 0, sliding window (now 3 fails, 1 healthy) remains degraded or unhealthy
  const flapProbe = await request('/api/v1/health', {
    method: 'POST',
    body: {
      environment: healthEnv,
      service_name: 'order-service',
      http_status: 200,
      latency_ms: 45,
      status: 'healthy',
      probe_type: 'readiness'
    }
  });
  const envAfterFlap = await request(`/api/v1/environments/${healthEnv}/status`);
  const statusFlap = envAfterFlap.data.environment?.current_health_status;
  const consecFlap = envAfterFlap.data.environment?.consecutive_failures;
  record(
    '1.4 Flapping probe resets consecutive_failures to 0',
    consecFlap === 0,
    { consecutive_failures: consecFlap, environment_status: statusFlap }
  );

  // 1.5 High Latency degraded threshold (>1000ms)
  // First clear to healthy baseline
  for (let i = 0; i < 5; i++) {
    await request('/api/v1/health', {
      method: 'POST',
      body: {
        environment: healthEnv,
        service_name: 'order-service',
        http_status: 200,
        latency_ms: 20,
        status: 'healthy',
        probe_type: 'readiness'
      }
    });
  }
  // Now submit high latency probe: 1200ms latency (>1000ms degraded threshold) with 200 OK
  const highLatencyProbe = await request('/api/v1/health', {
    method: 'POST',
    body: {
      environment: healthEnv,
      service_name: 'order-service',
      http_status: 200,
      latency_ms: 1200,
      probe_type: 'readiness'
    }
  });
  const envAfterLatency = await request(`/api/v1/environments/${healthEnv}/status`);
  const statusLatency = envAfterLatency.data.environment?.current_health_status;
  record(
    '1.5 High latency (>1000ms degraded threshold) transitions status to degraded',
    statusLatency === 'degraded',
    { latency_ms: 1200, reported_status: statusLatency, ack_status: highLatencyProbe.data?.environment_status }
  );

  // 1.6 High Latency with 2500ms (>2000ms)
  const veryHighLatencyProbe = await request('/api/v1/health', {
    method: 'POST',
    body: {
      environment: healthEnv,
      service_name: 'order-service',
      http_status: 200,
      latency_ms: 2500,
      probe_type: 'readiness'
    }
  });
  const envAfterVeryHigh = await request(`/api/v1/environments/${healthEnv}/status`);
  const statusVeryHigh = envAfterVeryHigh.data.environment?.current_health_status;
  record(
    '1.6 High latency (>2000ms) transitions status to degraded',
    statusVeryHigh === 'degraded',
    { latency_ms: 2500, reported_status: statusVeryHigh, ack_status: veryHighLatencyProbe.data?.environment_status }
  );

  // ------------------------------------------------------------------------
  // PART 2: Rollback Candidate Edge Cases
  // ------------------------------------------------------------------------
  console.log(`\n--- [PART 2: Rollback Candidate Edge Cases] ---`);

  // 2.1 Rollback candidate query on environment with NO deployments (aws)
  const candEmptyRes = await request('/api/v1/rollback/candidates/aws');
  const candEmpty = candEmptyRes.data?.candidate_release;
  record(
    '2.1 Environment with zero deployments returns null candidate (not a fake fallback)',
    candEmptyRes.status === 200 && candEmpty === null,
    { status: candEmptyRes.status, candidate_release: candEmpty }
  );

  // 2.2 Rollback invocation on environment with NO candidate (aws)
  const rollbackNoCand = await request('/api/v1/rollback', {
    method: 'POST',
    body: {
      environment: 'aws',
      reason: 'Rollback attempt on environment with no deployment history'
    }
  });
  record(
    '2.2 Rollback with no candidate fails gracefully (400, 404, or 422, not crash/success)',
    [400, 404, 422].includes(rollbackNoCand.status) && rollbackNoCand.data?.success !== true,
    { status: rollbackNoCand.status, response: rollbackNoCand.data }
  );

  // 2.3 Rollback candidate skips failed/unhealthy deployments
  // Let's create an environment 'local' with:
  // v1 (success)
  // v2 (failure)
  // v3 (in_progress / active)
  const testEnvName = 'local';
  const v1Ver = `v1.emp-${Date.now()}`;
  const v1Id = `rel-${v1Ver}`;
  await request('/api/v1/releases', {
    method: 'POST',
    body: { id: v1Id, version: v1Ver, commit_sha: 'sha1111111111111111111111111111111111111111' }
  });
  const d1 = await request('/api/v1/deployments', {
    method: 'POST',
    body: { release_id: v1Id, environment_id: testEnvName, status: 'in_progress' }
  });
  const d1Id = d1.data?.deployment?.id || d1.data?.id;
  await request(`/api/v1/deployments/${d1Id}/status`, {
    method: 'PATCH',
    body: { status: 'success' }
  });

  // Now deploy v2 as failure
  const v2Ver = `v2.emp-${Date.now()}`;
  const v2Id = `rel-${v2Ver}`;
  await request('/api/v1/releases', {
    method: 'POST',
    body: { id: v2Id, version: v2Ver, commit_sha: 'sha2222222222222222222222222222222222222222' }
  });
  const d2 = await request('/api/v1/deployments', {
    method: 'POST',
    body: { release_id: v2Id, environment_id: testEnvName, status: 'in_progress' }
  });
  const d2Id = d2.data?.deployment?.id || d2.data?.id;
  await request(`/api/v1/deployments/${d2Id}/status`, {
    method: 'PATCH',
    body: { status: 'failure', error_message: 'Deployment crashed during startup' }
  });

  // Now deploy v3 as active in_progress
  const v3Ver = `v3.emp-${Date.now()}`;
  const v3Id = `rel-${v3Ver}`;
  await request('/api/v1/releases', {
    method: 'POST',
    body: { id: v3Id, version: v3Ver, commit_sha: 'sha3333333333333333333333333333333333333333' }
  });
  const d3 = await request('/api/v1/deployments', {
    method: 'POST',
    body: { release_id: v3Id, environment_id: testEnvName, status: 'in_progress' }
  });

  // Query candidate for local: MUST be v1Ver, MUST NOT be v2Ver
  const candCheck = await request(`/api/v1/rollback/candidates/${testEnvName}`);
  const candObj = candCheck.data?.candidate_release;
  const isV1 = candObj?.version === v1Ver;
  const isNotV2 = candObj?.version !== v2Ver;
  record(
    '2.3 Candidate discovery skips failed deployment (v2) and selects last known-healthy (v1)',
    isV1 && isNotV2,
    { selected_candidate: candObj?.version, expected_candidate: v1Ver, failed_skipped: v2Ver }
  );

  // 2.4 Atomic target version pointer update during rollback execution
  const rollbackExec = await request('/api/v1/rollback', {
    method: 'POST',
    body: {
      environment: testEnvName,
      reason: 'Testing atomic target version pointer update',
      triggered_by: 'challenger-test'
    }
  });
  const envAfterRollback = await request(`/api/v1/environments/${testEnvName}/status`);
  const currentTargetVer = envAfterRollback.data.environment?.target_version;
  const rollbackDeployments = envAfterRollback.data.recent_deployments || [];
  const latestRollbackDep = rollbackDeployments[0];

  record(
    '2.4 Target version pointer updates atomically to candidate version',
    rollbackExec.status === 200 && currentTargetVer === v1Ver && latestRollbackDep?.trigger_type === 'rollback',
    {
      rollback_status: rollbackExec.status,
      target_version: currentTargetVer,
      expected: v1Ver,
      latest_deployment_trigger: latestRollbackDep?.trigger_type
    }
  );

  // ------------------------------------------------------------------------
  // PART 3: Webhook HMAC Boundary Cases & Payload Handling
  // ------------------------------------------------------------------------
  console.log(`\n--- [PART 3: Webhook Boundary Cases] ---`);

  // 3.1 Empty body with valid HMAC
  const emptyBody = '';
  const emptySig = computeHmac(WEBHOOK_SECRET, emptyBody);
  const emptyDeliveryId = crypto.randomUUID();
  const resEmptyWebhook = await request('/api/v1/webhooks/github', {
    method: 'POST',
    headers: {
      'X-GitHub-Delivery': emptyDeliveryId,
      'X-GitHub-Event': 'ping',
      'X-Hub-Signature-256': emptySig
    },
    body: emptyBody
  });
  record(
    '3.1 Empty payload with valid HMAC does not cause 500 Internal Server Error',
    resEmptyWebhook.status === 200 || resEmptyWebhook.status === 201 || resEmptyWebhook.status === 400,
    { status: resEmptyWebhook.status, body: resEmptyWebhook.data }
  );

  // 3.2 Malformed JSON body with valid HMAC
  const malformedJson = '{ "event": "deployment", unquoted_broken ';
  const malformedSig = computeHmac(WEBHOOK_SECRET, malformedJson);
  const malformedDeliveryId = crypto.randomUUID();
  const resMalformedWebhook = await request('/api/v1/webhooks/github', {
    method: 'POST',
    headers: {
      'X-GitHub-Delivery': malformedDeliveryId,
      'X-GitHub-Event': 'deployment',
      'X-Hub-Signature-256': malformedSig
    },
    body: malformedJson
  });
  record(
    '3.2 Malformed JSON payload with valid HMAC returns 400 Bad Request (not 500 crash)',
    resMalformedWebhook.status === 400,
    { status: resMalformedWebhook.status, body: resMalformedWebhook.data }
  );

  console.log(`\n======================================================`);
  console.log(`Summary of Results:`);
  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r.passed).length}`);
  console.log(`Failed: ${results.filter(r => !r.passed).length}`);
  console.log(`======================================================\n`);
}

runEmpiricalTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
