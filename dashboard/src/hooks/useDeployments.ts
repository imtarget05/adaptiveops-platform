import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import type { Deployment } from '../types/api';

export function useDeployments(environment?: string, pollIntervalMs = 5000) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeployments = useCallback(async () => {
    try {
      const data = await apiClient.getDeployments(environment);
      setDeployments(data.deployments);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch deployments');
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    fetchDeployments();

    if (pollIntervalMs > 0) {
      const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        fetchDeployments();
      }, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchDeployments, pollIntervalMs]);

  return { deployments, loading, error, refetch: fetchDeployments };
}
