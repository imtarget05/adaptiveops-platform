import React from 'react';
import { RefreshCw, Layers, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  lastUpdated: Date;
  onRefresh: () => void;
  loading: boolean;
  pollInterval: number;
  onPollIntervalChange: (interval: number) => void;
}

export const Header: React.FC<HeaderProps> = ({
  lastUpdated,
  onRefresh,
  loading,
  pollInterval,
  onPollIntervalChange
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 text-white shadow-lg shadow-indigo-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-100 tracking-tight">
                AdaptiveOps
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded-full">
                Control Plane v1.0
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Multi-Cloud Release Reliability & Controlled Rollback Platform
            </p>
          </div>
        </div>

        {/* Status & Controls */}
        <div className="flex items-center gap-3">
          {/* Cloudflare Edge Status Pill */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Edge Mesh Active</span>
          </div>

          {/* Sync frequency selector */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <span className="hidden lg:inline text-slate-500">Sync:</span>
            <select
              value={pollInterval}
              onChange={(e) => onPollIntervalChange(Number(e.target.value))}
              className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value={3000}>3s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={0}>Manual</option>
            </select>
          </div>

          {/* Refresh button */}
          <button
            onClick={onRefresh}
            disabled={loading}
            title={`Last updated: ${lastUpdated.toLocaleTimeString()}`}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-slate-300 border border-slate-800 hover:border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>
    </header>
  );
};
