import React, { useState } from 'react';
import { Header } from './components/Header';
import { LivePulseCard } from './components/LivePulseCard';
import { DeploymentTimeline } from './components/DeploymentTimeline';
import { ReleaseCatalog } from './components/ReleaseCatalog';
import { AuditLedger } from './components/AuditLedger';
import { RollbackModal } from './components/RollbackModal';
import { useEnvironments } from './hooks/useEnvironments';
import { useDeployments } from './hooks/useDeployments';
import { useReleases } from './hooks/useReleases';
import { useAuditLogs } from './hooks/useAuditLogs';
import type { Environment } from './types/api';
import { Activity, ShieldAlert, CheckCircle2, AlertTriangle, Layers, Clock, Package, Shield } from 'lucide-react';

export const App: React.FC = () => {
  const [pollInterval, setPollInterval] = useState(5000);
  const [activeTab, setActiveTab] = useState<'overview' | 'releases' | 'audit'>('overview');
  const [selectedEnvFilter, setSelectedEnvFilter] = useState<string>('');
  const [rollbackEnv, setRollbackEnv] = useState<Environment | null>(null);
  const [isRollbackOpen, setIsRollbackOpen] = useState(false);

  const {
    environments,
    loading: envLoading,
    error: envError,
    lastUpdated,
    refetch: refetchEnvs
  } = useEnvironments(pollInterval);

  const {
    deployments,
    loading: depLoading,
    refetch: refetchDeps
  } = useDeployments(selectedEnvFilter, pollInterval);

  const {
    releases,
    refetch: refetchReleases
  } = useReleases(pollInterval * 2);

  const {
    auditLogs,
    refetch: refetchAudit
  } = useAuditLogs(pollInterval);

  const handleRefreshAll = () => {
    refetchEnvs();
    refetchDeps();
    refetchReleases();
    refetchAudit();
  };

  const handleOpenRollback = (env: Environment) => {
    setRollbackEnv(env);
    setIsRollbackOpen(true);
  };

  const handleRollbackSuccess = () => {
    handleRefreshAll();
  };

  // Metrics summary
  const totalEnvs = environments.length;
  const healthyCount = environments.filter((e) => e.current_health_status === 'healthy').length;
  const degradedCount = environments.filter((e) => e.current_health_status === 'degraded').length;
  const unhealthyCount = environments.filter((e) => e.current_health_status === 'unhealthy').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation */}
      <Header
        lastUpdated={lastUpdated}
        onRefresh={handleRefreshAll}
        loading={envLoading || depLoading}
        pollInterval={pollInterval}
        onPollIntervalChange={setPollInterval}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Error notification if control plane is unreachable */}
        {envError && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>Control Plane Edge connection warning: {envError}</span>
            </div>
            <button
              onClick={handleRefreshAll}
              className="px-2.5 py-1 text-xs font-mono bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 rounded border border-rose-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Global Reliability KPI Banner */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur">
            <span className="text-xs font-medium text-slate-400 block mb-1">Target Environments</span>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold font-mono text-slate-100">{totalEnvs}</span>
              <Layers className="w-5 h-5 text-indigo-400" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur">
            <span className="text-xs font-medium text-emerald-400 block mb-1">Healthy</span>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold font-mono text-emerald-400">{healthyCount}</span>
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur">
            <span className="text-xs font-medium text-amber-400 block mb-1">Degraded</span>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold font-mono text-amber-400">{degradedCount}</span>
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur">
            <span className="text-xs font-medium text-rose-400 block mb-1">Unhealthy</span>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold font-mono text-rose-400">{unhealthyCount}</span>
              <ShieldAlert className="w-5 h-5 text-rose-500" />
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'overview'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Target Health & Timeline</span>
          </button>

          <button
            onClick={() => setActiveTab('releases')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'releases'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Release Catalog ({releases.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'audit'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Audit Ledger ({auditLogs.length})</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Live Environment Health Cards */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-200 uppercase font-mono tracking-wider">
                  Target Environment Profiles
                </h2>
                <span className="text-xs text-slate-500 font-mono">
                  {environments.length} active deployment targets
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {environments.map((env) => (
                  <LivePulseCard
                    key={env.id}
                    environment={env}
                    onOpenRollback={handleOpenRollback}
                  />
                ))}
              </div>
            </div>

            {/* Split Grid: Timeline + Audit Stream Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <DeploymentTimeline
                deployments={deployments}
                selectedEnvironment={selectedEnvFilter}
                onSelectEnvironment={setSelectedEnvFilter}
              />
              <AuditLedger auditLogs={auditLogs} />
            </div>
          </div>
        )}

        {activeTab === 'releases' && (
          <ReleaseCatalog releases={releases} />
        )}

        {activeTab === 'audit' && (
          <div className="max-w-4xl mx-auto">
            <AuditLedger auditLogs={auditLogs} />
          </div>
        )}
      </main>

      {/* Controlled Rollback Modal */}
      <RollbackModal
        isOpen={isRollbackOpen}
        environment={rollbackEnv}
        onClose={() => setIsRollbackOpen(false)}
        onSuccess={handleRollbackSuccess}
      />
    </div>
  );
};
