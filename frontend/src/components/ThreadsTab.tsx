import { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ThreadSummary, ThreadDetail } from '../lib/types';

interface Props {
  projectId: string;
}

export default function ThreadsTab({ projectId }: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selected, setSelected] = useState<ThreadDetail | null>(null);

  useEffect(() => { loadThreads(); }, [projectId]);

  async function loadThreads() {
    try {
      const res = await apiFetch(`/api/project/${projectId}/threads`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.items);
      }
    } catch (e) {
      console.error('Failed to load threads', e);
    }
  }

  async function openThread(threadId: string) {
    try {
      const res = await apiFetch(`/api/project/${projectId}/threads/${threadId}`);
      if (res.ok) setSelected(await res.json());
    } catch (e) {
      console.error('Failed to load thread', e);
    }
  }

  function bubbleClass(role: string) {
    switch (role) {
      case 'user': return 'bg-indigo-600 text-white';
      case 'system': return 'bg-yellow-50 text-yellow-800 border border-yellow-200';
      case 'tool': return 'bg-green-50 text-green-800 border border-green-200';
      default: return 'bg-gray-100 text-gray-900';
    }
  }

  // Thread detail view
  if (selected) {
    return (
      <div className="fade-in">
        <button
          onClick={() => setSelected(null)}
          className="mb-4 text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" /> Back to threads
        </button>
        <div className="bg-white rounded-xl shadow-sm border p-4 space-y-4" style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
          {selected.messages.map((msg) => (
            <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`chat-bubble rounded-2xl px-4 py-2.5 ${bubbleClass(msg.role)}`}>
                <div className="text-xs mb-1 opacity-60">{msg.role} | {formatDate(msg.created_at)}</div>
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Thread list view
  return (
    <div className="fade-in space-y-3">
      {threads.length === 0 && (
        <div className="text-center text-gray-400 py-16 bg-white rounded-xl border">No threads yet</div>
      )}
      {threads.map((thread) => (
        <div
          key={thread.id}
          onClick={() => openThread(thread.id)}
          className="bg-white rounded-xl shadow-sm border p-4 cursor-pointer hover:border-indigo-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900">
                Thread {thread.id.substring(0, 8)}...
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                User: {thread.user_id} | {thread.message_count} messages
              </div>
            </div>
            <div className="text-xs text-gray-400">{formatDate(thread.updated_at)}</div>
          </div>
          {thread.last_message && (
            <div className="text-sm text-gray-500 mt-2 truncate">{thread.last_message.content}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
