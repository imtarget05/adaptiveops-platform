import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import type { Environment } from '../types/api';

export function useEnvironments(pollIntervalMs = 5000) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchEnvironments = useCallback(async () => {
    try {
      const data = await apiClient.getEnvironments();
      setEnvironments(data.environments);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch environments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnvironments();

    if (pollIntervalMs > 0) {
      const interval = setInterval(() => {
        // Pause polling when browser tab is inactive to respect free tier quotas
        if (typeof document !== 'undefined' && document.hidden) {
          return;
        }
        fetchEnvironments();
      }, pollIntervalMs);

      return () => clearInterval(interval);
    }
  }, [fetchEnvironments, pollIntervalMs]);

  return { environments, loading, error, lastUpdated, refetch: fetchEnvironments };
}
