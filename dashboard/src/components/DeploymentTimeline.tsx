import React from 'react';
import { GitBranch, User, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import type { Deployment } from '../types/api';
import { StatusBadge } from './StatusBadge';

interface DeploymentTimelineProps {
  deployments: Deployment[];
  selectedEnvironment?: string;
  onSelectEnvironment?: (env: string) => void;
}

export const DeploymentTimeline: React.FC<DeploymentTimelineProps> = ({
  deployments,
  selectedEnvironment,
  onSelectEnvironment
}) => {
  const filtered = selectedEnvironment
    ? deployments.filter((d) => d.environment_id.toLowerCase() === selectedEnvironment.toLowerCase())
    : deployments;

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 backdrop-blur flex flex-col h-full">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span>Deployment Timeline</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time deployment audit stream across multi-cloud environments
          </p>
        </div>
        {selectedEnvironment && onSelectEnvironment && (
          <button
            onClick={() => onSelectEnvironment('')}
            className="text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Clear filter ({selectedEnvironment})
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          No deployments recorded yet.
        </div>
      ) : (
        <div className="space-y-4 overflow-y-auto max-h-[500px] pr-2">
          {filtered.map((dep, idx) => {
            const isSuccess = dep.status === 'success';
            const isFailure = dep.status === 'failure';
            const isRollback = dep.trigger_type === 'rollback' || dep.status === 'rolled_back';

            return (
              <div
                key={dep.id || idx}
                className="relative pl-6 pb-4 border-l border-slate-800 last:border-transparent last:pb-0 group"
              >
                {/* Timeline node icon */}
                <div className={`absolute -left-2.5 top-0 w-5 h-5 rounded-full flex items-center justify-center border ${
                  isSuccess
                    ? 'bg-emerald-950 border-emerald-500 text-emerald-400'
                    : isFailure
                      ? 'bg-rose-950 border-rose-500 text-rose-400'
                      : isRollback
                        ? 'bg-purple-950 border-purple-500 text-purple-400'
                        : 'bg-slate-950 border-slate-700 text-slate-400'
                }`}>
                  {isSuccess ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : isFailure ? (
                    <XCircle className="w-3 h-3" />
                  ) : (
                    <AlertCircle className="w-3 h-3" />
                  )}
                </div>

                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 hover:border-slate-700 transition-all">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-100">
                        {dep.release_version || dep.release_id}
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-slate-800 text-slate-400 rounded">
                        {dep.environment_id}
                      </span>
                      {dep.trigger_type === 'rollback' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded">
                          Rollback
                        </span>
                      )}
                    </div>
                    <StatusBadge status={dep.status} size="sm" />
                  </div>

                  <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1 font-mono">
                      <GitBranch className="w-3 h-3 text-slate-500" />
                      <span>{dep.strategy}</span>
                    </span>

                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-500" />
                      <span>{dep.deployed_by}</span>
                    </span>

                    <span className="text-slate-500 font-mono text-[11px] ml-auto">
                      {formatDate(dep.started_at)}
                    </span>
                  </div>

                  {dep.error_message && (
                    <div className="mt-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded p-2 font-mono">
                      {dep.error_message}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
