import React from 'react';
import { Server, GitCommit, RotateCcw, AlertCircle, ShieldCheck } from 'lucide-react';
import type { Environment } from '../types/api';
import { StatusBadge } from './StatusBadge';

interface LivePulseCardProps {
  environment: Environment;
  onOpenRollback: (env: Environment) => void;
}

export const LivePulseCard: React.FC<LivePulseCardProps> = ({ environment, onOpenRollback }) => {
  const isHealthy = environment.current_health_status === 'healthy';
  const isDegraded = environment.current_health_status === 'degraded';
  const isUnhealthy = environment.current_health_status === 'unhealthy';

  const pulseColor = isHealthy
    ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]'
    : isDegraded
      ? 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.7)]'
      : isUnhealthy
        ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.7)] animate-ping'
        : 'bg-slate-500';

  const pulseRing = isHealthy
    ? 'border-emerald-500/40 animate-pulse'
    : isDegraded
      ? 'border-amber-500/40 animate-pulse'
      : isUnhealthy
        ? 'border-rose-500/40 animate-pulse'
        : 'border-slate-700';

  const formatTime = (ts: string | null) => {
    if (!ts) return 'Never';
    try {
      const date = new Date(ts);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div className={`relative flex flex-col justify-between p-5 rounded-xl border bg-slate-900/80 backdrop-blur transition-all duration-200 hover:border-slate-600 ${
      isUnhealthy ? 'border-rose-500/40 shadow-lg shadow-rose-950/20' : 'border-slate-800'
    }`}>
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-5 h-5">
              <span className={`absolute w-3 h-3 rounded-full border-2 ${pulseRing}`} />
              <span className={`w-2 h-2 rounded-full ${pulseColor}`} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-1.5">
                {environment.name}
              </h3>
              <span className="text-xs font-mono uppercase text-slate-500 tracking-wider">
                {environment.type} profile
              </span>
            </div>
          </div>
          <StatusBadge status={environment.current_health_status} size="sm" />
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-3 p-3 my-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs">
          <div>
            <span className="text-slate-500 block mb-0.5">Active Release</span>
            <div className="flex items-center gap-1 font-mono font-medium text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
              <span>{environment.active_release_version || environment.target_version || 'v1.0.0'}</span>
            </div>
          </div>

          <div>
            <span className="text-slate-500 block mb-0.5">Commit SHA</span>
            <div className="flex items-center gap-1 font-mono text-slate-400">
              <GitCommit className="w-3.5 h-3.5 text-slate-500" />
              <span>
                {environment.active_release_commit_sha ? environment.active_release_commit_sha.slice(0, 7) : '9876543'}
              </span>
            </div>
          </div>

          <div>
            <span className="text-slate-500 block mb-0.5">Probe Failure Count</span>
            <div className={`font-mono font-medium flex items-center gap-1 ${
              environment.consecutive_failures > 0 ? 'text-amber-400' : 'text-slate-400'
            }`}>
              {environment.consecutive_failures > 0 && <AlertCircle className="w-3.5 h-3.5" />}
              <span>{environment.consecutive_failures} failures</span>
            </div>
          </div>

          <div>
            <span className="text-slate-500 block mb-0.5">Last Checked</span>
            <span className="text-slate-400 font-mono">
              {formatTime(environment.last_health_check_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500 flex items-center gap-1">
          <Server className="w-3 h-3" />
          <span>Target ID: <code className="text-slate-400 font-mono">{environment.id}</code></span>
        </span>

        <button
          onClick={() => onOpenRollback(environment)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/30 border border-rose-500/30 rounded-lg transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Rollback</span>
        </button>
      </div>
    </div>
  );
};
