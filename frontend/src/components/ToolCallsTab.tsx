import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ToolCallItem } from '../lib/types';

interface Props {
  projectId: string;
}

export default function ToolCallsTab({ projectId }: Props) {
  const [toolCalls, setToolCalls] = useState<ToolCallItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  const loadToolCalls = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiFetch(`/api/project/${projectId}/tool-calls?${params}`);
      if (res.ok) {
        const data = await res.json();
        setToolCalls(data.items);
      }
    } catch (e) {
      console.error('Failed to load tool calls', e);
    }
  }, [projectId, statusFilter]);

  useEffect(() => { loadToolCalls(); }, [loadToolCalls]);

  function statusColor(status: string) {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  function riskColor(risk: string) {
    switch (risk) {
      case 'high': return 'bg-red-50 text-red-600';
      case 'medium': return 'bg-yellow-50 text-yellow-600';
      default: return 'bg-green-50 text-green-600';
    }
  }

  return (
    <div className="fade-in">
      <div className="flex gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={loadToolCalls} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="space-y-3">
        {toolCalls.length === 0 && (
          <div className="text-center text-gray-400 py-16 bg-white rounded-xl border">No tool calls</div>
        )}
        {toolCalls.map((tc) => (
          <div key={tc.id} className="bg-white rounded-xl shadow-sm border p-4 fade-in">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-gray-900">{tc.name}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(tc.status)}`}>
                    {tc.status}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${riskColor(tc.risk)}`}>
                    {tc.risk} risk
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">{formatDate(tc.created_at)}</div>
              </div>
            </div>
            <div className="mt-2 space-y-1">
              <details className="text-sm">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Arguments</summary>
                <pre className="mt-1 bg-gray-50 rounded p-2 text-xs overflow-auto">
                  {JSON.stringify(tc.args, null, 2)}
                </pre>
              </details>
              {tc.result && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Result</summary>
                  <pre className="mt-1 bg-gray-50 rounded p-2 text-xs overflow-auto">
                    {JSON.stringify(tc.result, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
