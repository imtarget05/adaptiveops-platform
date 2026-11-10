import React, { useState } from 'react';
import { Shield, ChevronRight, ChevronDown, Clock, User, HardDrive } from 'lucide-react';
import type { AuditLog } from '../types/api';

interface AuditLedgerProps {
  auditLogs: AuditLog[];
}

export const AuditLedger: React.FC<AuditLedgerProps> = ({ auditLogs }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return ts;
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('ROLLBACK')) return 'text-purple-400 bg-purple-500/10 border-purple-500/30';
    if (action.includes('FAIL') || action.includes('ALERT')) return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    if (action.includes('SUCCESS') || action.includes('INIT')) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    return 'text-slate-300 bg-slate-800 border-slate-700';
  };

  return (
    <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 backdrop-blur flex flex-col h-full">
      <div className="pb-4 border-b border-slate-800 mb-4">
        <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-400" />
          <span>Immutable Audit Ledger</span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Tamper-evident system activity and controlled rollback records
        </p>
      </div>

      {auditLogs.length === 0 ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          No audit entries recorded yet.
        </div>
      ) : (
        <div className="space-y-2.5 overflow-y-auto max-h-[500px] pr-2">
          {auditLogs.map((log) => {
            const isExpanded = expandedId === log.id;
            const actionStyle = getActionColor(log.action);

            return (
              <div
                key={log.id}
                className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 hover:border-slate-700 transition-all text-xs"
              >
                <div
                  className="flex items-center justify-between gap-3 cursor-pointer select-none"
                  onClick={() => toggleExpand(log.id)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 font-mono text-[11px] font-semibold rounded border ${actionStyle}`}>
                      {log.action}
                    </span>

                    {log.environment_id && (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-slate-800 text-slate-400 rounded">
                        {log.environment_id}
                      </span>
                    )}

                    <span className="text-slate-400 font-mono flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-500" />
                      <span>{log.actor}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-mono text-[11px] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatTimestamp(log.created_at)}</span>
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                </div>

                {/* Target info */}
                <div className="mt-2 text-slate-500 flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3 h-3 text-slate-600" />
                    <span>Target: <code className="text-slate-400 font-mono">{log.target_type}:{log.target_id}</code></span>
                  </span>
                  <span>ID: <code className="text-slate-500 font-mono">{log.id}</code></span>
                </div>

                {/* Expandable JSON details */}
                {isExpanded && log.details_json && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80">
                    <span className="text-slate-400 block mb-1 font-semibold text-[11px]">
                      Audit Context & Payload:
                    </span>
                    <pre className="p-2.5 rounded bg-slate-900 border border-slate-800 text-indigo-300 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(log.details_json), null, 2);
                        } catch {
                          return log.details_json;
                        }
                      })()}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
