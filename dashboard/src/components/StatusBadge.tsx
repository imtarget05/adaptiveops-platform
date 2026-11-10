import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Clock, RotateCcw, HelpCircle } from 'lucide-react';
import type { HealthStatus, DeploymentStatus } from '../types/api';

interface StatusBadgeProps {
  status: HealthStatus | DeploymentStatus | string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const normalized = status.toLowerCase();

  let bg = 'bg-slate-800 text-slate-300 border-slate-700';
  let icon = <HelpCircle className="w-3.5 h-3.5" />;
  let label = status;

  switch (normalized) {
    case 'healthy':
    case 'success':
      bg = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      label = normalized === 'healthy' ? 'Healthy' : 'Success';
      break;

    case 'degraded':
    case 'in_progress':
    case 'pending':
      bg = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      icon = <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
      label = normalized === 'degraded' ? 'Degraded' : normalized === 'in_progress' ? 'In Progress' : 'Pending';
      break;

    case 'unhealthy':
    case 'failure':
    case 'failed':
      bg = 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      icon = <XCircle className="w-3.5 h-3.5 text-rose-400" />;
      label = normalized === 'unhealthy' ? 'Unhealthy' : 'Failure';
      break;

    case 'rolled_back':
      bg = 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      icon = <RotateCcw className="w-3.5 h-3.5 text-purple-400" />;
      label = 'Rolled Back';
      break;

    case 'unknown':
      bg = 'bg-slate-800 text-slate-400 border-slate-700';
      icon = <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />;
      label = 'Unknown';
      break;
  }

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium rounded-full border ${bg} ${sizeClasses}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
};
