import { useState, useEffect, useCallback } from 'react';
import { Check, X, Trash2, RefreshCw, CheckSquare, Square, AlertTriangle } from 'lucide-react';
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

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
        setSelected(new Set());
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

  // Bulk operations
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  async function bulkAction(action: 'accept' | 'reject' | 'delete') {
    if (selected.size === 0) return;
    const label = action === 'delete' ? 'delete' : action;
    if (!confirm(`${label} ${selected.size} selected items?`)) return;

    setBulkLoading(true);
    try {
      const res = await apiFetch(`/api/project/${projectId}/memory-items/bulk`, {
        method: 'POST',
        body: JSON.stringify({ action, ids: Array.from(selected) }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.errors?.length) {
          alert(`Processed ${data.processed}, errors: ${data.errors.length}`);
        }
        loadItems();
      }
    } catch (e) {
      console.error('Bulk action failed', e);
    } finally {
      setBulkLoading(false);
    }
  }

  async function purgeFiltered() {
    if (!typeFilter && !statusFilter) {
      alert('Select at least a type or status filter before purging.');
      return;
    }
    const desc = [typeFilter, statusFilter].filter(Boolean).join(' + ');
    if (!confirm(`Purge ALL "${desc}" memory items? This cannot be undone.`)) return;

    setPurgeLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiFetch(`/api/project/${projectId}/memory-items/purge?${params}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Purged ${data.deleted} / ${data.total} items`);
        loadItems();
      }
    } catch (e) {
      console.error('Purge failed', e);
    } finally {
      setPurgeLoading(false);
    }
  }

  function contentPreview(content: Record<string, unknown>): string {
    return Object.entries(content)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' | ');
  }

  const allSelected = items.length > 0 && selected.size === items.length;

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

        <div className="ml-auto flex gap-2">
          {(typeFilter || statusFilter) && (
            <button
              onClick={purgeFiltered}
              disabled={purgeLoading}
              className="px-3 py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg flex items-center gap-1 disabled:opacity-50"
            >
              <AlertTriangle className="w-4 h-4" />
              {purgeLoading ? 'Purging...' : 'Purge filtered'}
            </button>
          )}
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2">
          <span className="text-sm font-medium text-indigo-800">{selected.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => bulkAction('accept')}
              disabled={bulkLoading}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
            >
              <Check className="w-4 h-4" /> Accept
            </button>
            <button
              onClick={() => bulkAction('reject')}
              disabled={bulkLoading}
              className="px-3 py-1.5 text-sm bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 flex items-center gap-1"
            >
              <X className="w-4 h-4" /> Reject
            </button>
            <button
              onClick={() => bulkAction('delete')}
              disabled={bulkLoading}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-center text-gray-400 py-16 bg-white rounded-xl border">
            No memory items found
          </div>
        )}

        {items.length > 0 && (
          <div className="flex items-center px-1 mb-1">
            <button onClick={toggleSelectAll} className="p-1 text-gray-400 hover:text-gray-600">
              {allSelected ? <CheckSquare className="w-5 h-5 text-indigo-600" /> : <Square className="w-5 h-5" />}
            </button>
            <span className="text-xs text-gray-400 ml-2">Select all</span>
          </div>
        )}

        {items.map((item) => (
          <div key={item.id} className="bg-white rounded-xl shadow-sm border p-4 fade-in">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <button onClick={() => toggleSelect(item.id)} className="mt-0.5 p-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0">
                  {selected.has(item.id) ? <CheckSquare className="w-5 h-5 text-indigo-600" /> : <Square className="w-5 h-5" />}
                </button>
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
