import { useState, useEffect, useCallback } from 'react';
import { Check, X, Trash2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { MemoryItem } from '../lib/types';

interface Props {
  projectId: string;
}

const MEMORY_TYPES = ['fact', 'rule', 'event', 'decision', 'open_loop', 'idea', 'metric', 'preference', 'lesson', 'finding', 'impl_task'];
const MEMORY_STATUSES = ['proposed', 'accepted', 'rejected', 'done', 'blocked', 'active'];

const TYPE_COLORS: Record<string, string> = {
  fact: 'bg-blue-100 text-blue-800',
  rule: 'bg-purple-100 text-purple-800',
  event: 'bg-gray-100 text-gray-800',
  decision: 'bg-indigo-100 text-indigo-800',
  open_loop: 'bg-orange-100 text-orange-800',
  idea: 'bg-yellow-100 text-yellow-800',
  metric: 'bg-teal-100 text-teal-800',
  preference: 'bg-pink-100 text-pink-800',
  lesson: 'bg-cyan-100 text-cyan-800',
  finding: 'bg-red-100 text-red-800',
  impl_task: 'bg-emerald-100 text-emerald-800',
};

const STATUS_COLORS: Record<string, string> = {
  proposed: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  done: 'bg-gray-100 text-gray-800',
  blocked: 'bg-orange-100 text-orange-800',
  active: 'bg-blue-100 text-blue-800',
};

export default function MemoryTab({ projectId }: Props) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiFetch(`/api/project/${projectId}/memory-items?${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setTotal(data.total);
      }
    } catch (e) {
      console.error('Failed to load memory items', e);
    }
  }, [projectId, typeFilter, statusFilter]);

  useEffect(() => { loadItems(); }, [loadItems]);

  async function updateStatus(id: string, status: string) {
    try {
      const res = await apiFetch(`/api/memory-items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (res.ok) loadItems();
    } catch (e) {
      console.error('Failed to update', e);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this memory item?')) return;
    try {
      const res = await apiFetch(`/api/memory-items/${id}`, { method: 'DELETE' });
      if (res.ok) loadItems();
    } catch (e) {
      console.error('Failed to delete', e);
    }
  }

  function contentPreview(content: Record<string, unknown>): string {
    return Object.entries(content)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' | ');
  }

  return (
    <div className="fade-in">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Types</option>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          {MEMORY_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={loadItems} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
        <span className="text-sm text-gray-400 self-center">{items.length} / {total} items</span>
      </div>

      {/* Items */}
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-center text-gray-400 py-16 bg-white rounded-xl border">
            No memory items found
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="bg-white rounded-xl shadow-sm border p-4 fade-in">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[item.type] || 'bg-gray-100 text-gray-800'}`}>
                    {item.type}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-800'}`}>
                    {item.status}
                  </span>
                  <span className="text-xs text-gray-400">{formatDate(item.created_at)}</span>
                </div>
                <h4 className="font-medium text-gray-900 mt-1">{item.title}</h4>
                <div className="text-sm text-gray-600 mt-1 line-clamp-2">{contentPreview(item.content)}</div>
                {item.tags.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    {item.tags.map((tag) => (
                      <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {item.status === 'proposed' && (
                  <>
                    <button
                      onClick={() => updateStatus(item.id, 'accepted')}
                      title="Accept"
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => updateStatus(item.id, 'rejected')}
                      title="Reject"
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => deleteItem(item.id)}
                  title="Delete"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
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
