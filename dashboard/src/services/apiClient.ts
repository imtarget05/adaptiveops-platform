import type {
  Environment,
  Release,
  Deployment,
  HealthMetric,
  AuditLog,
  RollbackCandidateResponse
} from '../types/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': import.meta.env.VITE_ADMIN_API_KEY || 'dev-admin-api-key',
      ...(options?.headers || {})
    }
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errBody = await res.json();
      errorMsg = errBody.message || errBody.error || errorMsg;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  return res.json() as Promise<T>;
}

export const apiClient = {
  getEnvironments: async (): Promise<{ environments: Environment[] }> => {
    return fetchJson<{ environments: Environment[] }>('/environments');
  },

  getReleases: async (limit = 30): Promise<{ releases: Release[]; total: number }> => {
    return fetchJson<{ releases: Release[]; total: number }>(`/releases?limit=${limit}`);
  },

  getDeployments: async (environment?: string, limit = 50): Promise<{ deployments: Deployment[]; total: number }> => {
    const query = environment ? `?environment=${encodeURIComponent(environment)}&limit=${limit}` : `?limit=${limit}`;
    return fetchJson<{ deployments: Deployment[]; total: number }>(`/deployments${query}`);
  },

  getHealthMetrics: async (environment: string, limit = 30): Promise<{ metrics: HealthMetric[] }> => {
    return fetchJson<{ metrics: HealthMetric[] }>(`/health/${encodeURIComponent(environment)}?limit=${limit}`);
  },

  getAuditLogs: async (limit = 50): Promise<{ audit_logs: AuditLog[]; total: number }> => {
    return fetchJson<{ audit_logs: AuditLog[]; total: number }>(`/audit?limit=${limit}`);
  },

  getRollbackCandidate: async (environment: string): Promise<RollbackCandidateResponse> => {
    return fetchJson<RollbackCandidateResponse>(`/rollback/candidates/${encodeURIComponent(environment)}`);
  },

  executeRollback: async (payload: {
    environment: string;
    target_version?: string;
    target_release_id?: string;
    reason: string;
    triggered_by?: string;
  }): Promise<{ success: boolean; rollback_id: string; target_version: string; message: string }> => {
    return fetchJson<{ success: boolean; rollback_id: string; target_version: string; message: string }>('/rollback', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
};
