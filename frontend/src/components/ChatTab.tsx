import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { marked } from 'marked';
import { apiFetch } from '../lib/api';
import type { Message } from '../lib/types';

interface Props {
  projectId: string;
}

export default function ChatTab({ projectId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState('');
  const [userId, setUserId] = useState('admin');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const message = input.trim();
    setInput('');

    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        user_id: userId || 'admin',
        message,
        tools: [],
      };
      if (threadId) body.thread_id = threadId;

      const res = await apiFetch('/chat', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'system',
            content: `Error: ${data.error || 'Unknown error'}`,
            created_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      setThreadId(data.thread_id);
      setMessages((prev) => [
        ...prev,
        {
          id: `resp_${Date.now()}`,
          role: 'assistant',
          content: data.render?.text_to_send_to_user || data.response_json?.message || '',
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'system',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function newThread() {
    setThreadId('');
    setMessages([]);
  }

  function bubbleClass(role: string) {
    switch (role) {
      case 'user':
        return 'bg-indigo-600 text-white';
      case 'system':
        return 'bg-yellow-50 text-yellow-800 border border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-900';
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border flex flex-col" style={{ height: 'calc(100vh - 180px)' }}>
      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 py-20">
            <MessageSquareIcon />
            <p className="mt-4 text-sm">Start a conversation with the agent</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`chat-bubble rounded-2xl px-4 py-2.5 ${bubbleClass(msg.role)}`}>
              <div className="text-xs mb-1 opacity-60">{msg.role}</div>
              {msg.role === 'assistant' ? (
                <div
                  className="text-sm prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) as string }}
                />
              ) : (
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <form onSubmit={sendMessage} className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
            placeholder="Type your message..."
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </form>
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
          <label className="flex items-center gap-1">
            <span>User ID:</span>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="border-0 border-b border-gray-200 px-1 py-0.5 w-24 text-xs focus:outline-none focus:border-indigo-400"
              placeholder="admin"
            />
          </label>
          {threadId && (
            <>
              <span className="truncate max-w-xs">Thread: {threadId}</span>
              <button onClick={newThread} className="text-indigo-500 hover:text-indigo-700">
                New Thread
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageSquareIcon() {
  return (
    <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}
