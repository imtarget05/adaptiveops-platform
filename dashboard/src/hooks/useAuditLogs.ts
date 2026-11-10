import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import type { AuditLog } from '../types/api';

export function useAuditLogs(pollIntervalMs = 5000) {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const data = await apiClient.getAuditLogs();
      setAuditLogs(data.audit_logs);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuditLogs();

    if (pollIntervalMs > 0) {
      const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        fetchAuditLogs();
      }, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchAuditLogs, pollIntervalMs]);

  return { auditLogs, loading, error, refetch: fetchAuditLogs };
}
