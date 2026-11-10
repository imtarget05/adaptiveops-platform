import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import type { Release } from '../types/api';

export function useReleases(pollIntervalMs = 10000) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReleases = useCallback(async () => {
    try {
      const data = await apiClient.getReleases();
      setReleases(data.releases);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch releases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReleases();

    if (pollIntervalMs > 0) {
      const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        fetchReleases();
      }, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchReleases, pollIntervalMs]);

  return { releases, loading, error, refetch: fetchReleases };
}
