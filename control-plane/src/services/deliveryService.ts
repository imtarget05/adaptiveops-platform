import type { Env } from '../types/env';
import type { Event } from '../types/models';
import {
  listPendingDeliveries,
  recordDeliveryAttempt,
  markDelivered,
  markFailed,
  computeBackoff,
} from './eventService';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_BASE_BACKOFF_MS = 1000;

export interface DeliveryAttemptResult {
  eventId: string;
  attempt: number;
  status: 'delivered' | 'retry' | 'dlq';
  httpStatus: number | null;
  errorMessage: string | null;
  durationMs: number | null;
}

export interface DispatchOptions {
  limit?: number;
  timeoutMs?: number;
  baseBackoffMs?: number;
  dryRun?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ipv4Octets(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split('.').map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isNonPublicIpv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
    (a === 203 && b === 0 && c === 113) || a >= 224;
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  const ipv4 = ipv4Octets(hostname);
  if (ipv4) return ipv4[0] === 127;
  const ipv6 = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return ipv6 === '::1' || ipv6 === '0:0:0:0:0:0:0:1';
}

function isNonPublicIpv6(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') ||
      /^fe[89ab]/.test(h) || h.startsWith('ff') || h.startsWith('2001:db8:')) return true;

  // IPv4-mapped IPv6 addresses must receive the same checks as IPv4 targets.
  if (h.startsWith('::ffff:')) {
    const mapped = h.slice('::ffff:'.length);
    const dotted = ipv4Octets(mapped) ? mapped : null;
    if (dotted) return isNonPublicIpv4(dotted);
    const words = mapped.split(':');
    if (words.length === 2 && words.every((word) => /^[\da-f]{1,4}$/.test(word))) {
      const value = (parseInt(words[0], 16) << 16) | parseInt(words[1], 16);
      return isNonPublicIpv4(`${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`);
    }
    return true;
  }
  return false;
}

function isPrivateOrInternalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return isNonPublicIpv4(h) || isNonPublicIpv6(h) || h === 'localhost' || h.endsWith('.localhost');
}

export function isAllowedTargetUrl(
  targetUrl: string | null | undefined,
  environment = 'production'
): { allowed: boolean; reason?: string } {
  if (!targetUrl) {
    return { allowed: false, reason: 'missing target_url' };
  }
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return { allowed: false, reason: 'invalid url' };
  }
  const localEnvironment = ['local', 'development', 'test'].includes(environment.toLowerCase());
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: 'unsupported protocol' };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: 'credentials in target URL are not allowed' };
  }
  if (loopback) {
    return localEnvironment && url.protocol === 'http:'
      ? { allowed: true }
      : { allowed: false, reason: 'loopback targets are only allowed over HTTP in local development' };
  }
  if (isPrivateOrInternalHost(url.hostname)) {
    return { allowed: false, reason: 'private or internal host blocked (SSRF)' };
  }
  if (url.protocol !== 'https:') return { allowed: false, reason: 'HTTPS is required for public targets' };
  return { allowed: true };
}

function classifyHttpStatus(status: number): 'delivered' | 'retry' | 'permanent_failure' {
  if (status >= 200 && status < 300) return 'delivered';
  if (status === 429 || status >= 500) return 'retry';
  return 'permanent_failure';
}

export async function deliverEvent(
  env: Env,
  event: Event,
  options: { timeoutMs?: number; baseBackoffMs?: number } = {}
): Promise<DeliveryAttemptResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const attempt = event.retry_count + 1;

  const urlCheck = isAllowedTargetUrl(event.target_url ?? undefined, env.ENVIRONMENT);
  if (!urlCheck.allowed) {
    await recordDeliveryAttempt(
      env,
      event.id,
      attempt,
      event.target_url ?? '',
      null,
      null,
      urlCheck.reason ?? 'blocked',
      null
    );
    const outcome = await markFailed(
      env,
      event.id,
      attempt,
      event.max_retries,
      `dlq: ${urlCheck.reason}`,
      null,
      urlCheck.reason ?? 'blocked'
    );
    return {
      eventId: event.id,
      attempt,
      status: outcome === 'dlq' ? 'dlq' : 'retry',
      httpStatus: null,
      errorMessage: urlCheck.reason ?? 'blocked',
      durationMs: null,
    };
  }

  const start = Date.now();
  let httpStatus: number | null = null;
  const responseBodyPreview: string | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(event.target_url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AdaptiveOps-Event-Id': event.id,
          'X-AdaptiveOps-Attempt': String(attempt),
        },
        body: event.payload_json,
        signal: controller.signal,
        redirect: 'manual',
      });
      httpStatus = res.status;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err: any) {
    errorMessage = err?.message ?? String(err);
  } finally {
    // noop
  }

  const durationMs = Date.now() - start;
  const classified = httpStatus ? classifyHttpStatus(httpStatus) : 'retry'; // network error => retry

  await recordDeliveryAttempt(
    env,
    event.id,
    attempt,
    event.target_url!,
    httpStatus,
    responseBodyPreview,
    errorMessage,
    durationMs
  );

  if (classified === 'delivered') {
    await markDelivered(env, event.id);
    return {
      eventId: event.id,
      attempt,
      status: 'delivered',
      httpStatus,
      errorMessage: null,
      durationMs,
    };
  }

  if (classified === 'permanent_failure') {
    const outcome = await markFailed(
      env,
      event.id,
      attempt,
      event.max_retries,
      'permanent_failure',
      httpStatus,
      errorMessage ?? `HTTP ${httpStatus}`
    );
    return {
      eventId: event.id,
      attempt,
      status: outcome === 'dlq' ? 'dlq' : 'retry',
      httpStatus,
      errorMessage,
      durationMs,
    };
  }

  // retryable (429/5xx/network)
  const outcome = await markFailed(
    env,
    event.id,
    attempt,
    event.max_retries,
    'retryable',
    httpStatus,
    errorMessage ?? `HTTP ${httpStatus}`
  );
  return {
    eventId: event.id,
    attempt,
    status: outcome === 'dlq' ? 'dlq' : 'retry',
    httpStatus,
    errorMessage,
    durationMs,
  };
}

export async function dispatchPending(
  env: Env,
  options: DispatchOptions = {}
): Promise<{
  processed: number;
  delivered: number;
  retried: number;
  dlq: number;
  details: DeliveryAttemptResult[];
}> {
  const limit = options.limit ?? 50;
  const events = await listPendingDeliveries(env, limit);

  let delivered = 0;
  let retried = 0;
  let dlq = 0;
  const details: DeliveryAttemptResult[] = [];

  for (const event of events) {
    const result = await deliverEvent(env, event, {
      timeoutMs: options.timeoutMs,
      baseBackoffMs: options.baseBackoffMs,
    });
    details.push(result);
    if (result.status === 'delivered') delivered += 1;
    else if (result.status === 'dlq') dlq += 1;
    else retried += 1;
  }

  return {
    processed: events.length,
    delivered,
    retried,
    dlq,
    details,
  };
}
