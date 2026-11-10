import React, { useState } from 'react';
import { Package, GitCommit, Search, Calendar, Tag, User } from 'lucide-react';
import type { Release } from '../types/api';

interface ReleaseCatalogProps {
  releases: Release[];
}

export const ReleaseCatalog: React.FC<ReleaseCatalogProps> = ({ releases }) => {
  const [search, setSearch] = useState('');

  const filtered = releases.filter((r) => {
    const q = search.toLowerCase();
    return (
      r.version.toLowerCase().includes(q) ||
      (r.commit_message && r.commit_message.toLowerCase().includes(q)) ||
      (r.branch && r.branch.toLowerCase().includes(q)) ||
      r.git_author.toLowerCase().includes(q)
    );
  });

  const formatDate = (isoStr: string) => {
    try {
      return new Date(isoStr).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 backdrop-blur">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-400" />
            <span>Release Catalog</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Registered application releases, build artifacts, and container tags
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search version, commit, author..."
            className="w-full sm:w-64 pl-8 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500 font-mono uppercase tracking-wider">
              <th className="pb-3 font-medium">Version</th>
              <th className="pb-3 font-medium">Commit</th>
              <th className="pb-3 font-medium">Commit Message</th>
              <th className="pb-3 font-medium">Container Tag</th>
              <th className="pb-3 font-medium">Author</th>
              <th className="pb-3 font-medium text-right">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                  No releases found matching query.
                </td>
              </tr>
            ) : (
              filtered.map((rel) => (
                <tr key={rel.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 pr-4 font-semibold text-indigo-300">
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3 h-3 text-indigo-400" />
                      <span>{rel.version}</span>
                    </div>
                  </td>

                  <td className="py-3 pr-4 text-slate-400">
                    <div className="flex items-center gap-1">
                      <GitCommit className="w-3 h-3 text-slate-500" />
                      <span>{rel.commit_sha.slice(0, 7)}</span>
                    </div>
                  </td>

                  <td className="py-3 pr-4 font-sans text-slate-300 max-w-xs truncate">
                    {rel.commit_message || 'No description'}
                  </td>

                  <td className="py-3 pr-4 text-slate-400 max-w-[200px] truncate text-[11px]">
                    {rel.container_image_tag || 'none'}
                  </td>

                  <td className="py-3 pr-4 font-sans text-slate-400">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-500" />
                      <span>{rel.git_author}</span>
                    </div>
                  </td>

                  <td className="py-3 text-right text-slate-500 text-[11px]">
                    <div className="flex items-center justify-end gap-1 font-sans">
                      <Calendar className="w-3 h-3 text-slate-500" />
                      <span>{formatDate(rel.created_at)}</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
