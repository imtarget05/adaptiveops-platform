import React, { useState, useEffect } from 'react';
import { RotateCcw, AlertTriangle, ShieldCheck, CheckCircle2, X, Loader2 } from 'lucide-react';
import type { Environment, RollbackCandidate } from '../types/api';
import { apiClient } from '../services/apiClient';

interface RollbackModalProps {
  isOpen: boolean;
  environment: Environment | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const RollbackModal: React.FC<RollbackModalProps> = ({
  isOpen,
  environment,
  onClose,
  onSuccess
}) => {
  const [candidate, setCandidate] = useState<RollbackCandidate | null>(null);
  const [loadingCandidate, setLoadingCandidate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({
    schemaCompatible: true,
    containerReady: true,
    trafficDrained: true
  });

  useEffect(() => {
    if (isOpen && environment) {
      setReason(`Automated rollback initiated due to health degradation on ${environment.name}`);
      setError(null);
      setLoadingCandidate(true);

      apiClient
        .getRollbackCandidate(environment.id)
        .then((res) => {
          setCandidate(res.candidate_release);
        })
        .catch((err) => {
          setError(err.message || 'Failed to resolve rollback candidate release');
        })
        .finally(() => {
          setLoadingCandidate(false);
        });
    } else {
      setCandidate(null);
    }
  }, [isOpen, environment]);

  if (!isOpen || !environment) return null;

  const allGatesPassed = checklist.schemaCompatible && checklist.containerReady && checklist.trafficDrained;
  const canSubmit = allGatesPassed && reason.trim().length > 5 && !submitting && candidate !== null;

  const handleExecute = async () => {
    if (!canSubmit || !candidate) return;
    setSubmitting(true);
    setError(null);

    try {
      await apiClient.executeRollback({
        environment: environment.id,
        target_version: candidate.version,
        target_release_id: candidate.release_id,
        reason: reason.trim(),
        triggered_by: 'dashboard-operator'
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to execute rollback');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Controlled Rollback Execution
              </h2>
              <span className="text-xs font-mono text-slate-400">
                Target: {environment.name} ({environment.id})
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Current vs Candidate comparison card */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div>
              <span className="text-slate-500 block mb-1">Current Active Version</span>
              <div className="font-mono font-semibold text-slate-200 text-sm">
                {environment.active_release_version || environment.target_version || 'v1.0.0'}
              </div>
              <span className="text-[11px] text-rose-400 font-mono">
                Status: {environment.current_health_status}
              </span>
            </div>

            <div>
              <span className="text-slate-500 block mb-1">Rollback Target Candidate</span>
              {loadingCandidate ? (
                <div className="flex items-center gap-2 text-slate-400 font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Discovering...</span>
                </div>
              ) : candidate ? (
                <div>
                  <div className="font-mono font-semibold text-emerald-400 text-sm flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>{candidate.version}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    SHA: {candidate.commit_sha.slice(0, 7)}
                  </span>
                </div>
              ) : (
                <span className="text-amber-400 font-mono">No candidate found</span>
              )}
            </div>
          </div>

          {/* Safety Verification Checklist */}
          <div>
            <label className="text-slate-300 font-semibold block mb-2">
              Safety Verification Gates:
            </label>
            <div className="space-y-2 p-3 bg-slate-950/40 border border-slate-800/80 rounded-lg">
              <label className="flex items-center gap-2.5 cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={checklist.schemaCompatible}
                  onChange={(e) =>
                    setChecklist((c) => ({ ...c, schemaCompatible: e.target.checked }))
                  }
                  className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0"
                />
                <span>Database Expand/Contract schema backward compatibility confirmed</span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={checklist.containerReady}
                  onChange={(e) =>
                    setChecklist((c) => ({ ...c, containerReady: e.target.checked }))
                  }
                  className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0"
                />
                <span>Container image artifact is pinned and available in registry</span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={checklist.trafficDrained}
                  onChange={(e) =>
                    setChecklist((c) => ({ ...c, trafficDrained: e.target.checked }))
                  }
                  className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0"
                />
                <span>Safe rolling deployment parameters confirmed</span>
              </label>
            </div>
          </div>

          {/* Mandatory reason */}
          <div>
            <label className="text-slate-300 font-semibold block mb-1">
              Rollback Justification / Reason (Audited):
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Provide context and verification findings for this rollback..."
              className="w-full p-2.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-800 bg-slate-950/40">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleExecute}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-lg shadow-rose-950/40 transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Initiating Rollback...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirm & Execute Rollback</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
