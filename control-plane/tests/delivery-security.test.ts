import { describe, expect, it } from 'vitest';
import { isAllowedTargetUrl } from '../src/services/deliveryService';

describe('webhook target URL safety', () => {
  it.each([
    'http://localhost:8080/health',
    'http://127.0.0.1/health',
    'http://10.1.2.3/hook',
    'http://172.16.0.1/hook',
    'http://192.168.1.10/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/hook',
    'http://[fd00::1]/hook',
    'http://user:password@example.com/hook'
  ])('blocks unsafe target %s in production', (target) => {
    expect(isAllowedTargetUrl(target, 'production').allowed).toBe(false);
  });

  it('allows a loopback HTTP target only in local development', () => {
    expect(isAllowedTargetUrl('http://localhost:8080/health', 'development').allowed).toBe(true);
    expect(isAllowedTargetUrl('http://localhost:8080/health', 'production').allowed).toBe(false);
  });

  it('requires HTTPS for public targets', () => {
    expect(isAllowedTargetUrl('http://receiver.example.com/hook', 'production').allowed).toBe(false);
    expect(isAllowedTargetUrl('https://receiver.example.com/hook', 'production').allowed).toBe(true);
  });
});
