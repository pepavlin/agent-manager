import { useState } from 'react';
import { Monitor } from 'lucide-react';
import { setApiKey, apiFetch } from '../lib/api';

interface Props {
  onLogin: (apiKey: string, projectId: string) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [apiKeyInput, setApiKeyInput] = useState(sessionStorage.getItem('agentApiKey') || '');
  const [projectId, setProjectId] = useState(sessionStorage.getItem('projectId') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      setApiKey(apiKeyInput);
      const res = await apiFetch(`/api/project/${projectId}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to connect');
        return;
      }
      onLogin(apiKeyInput, projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-indigo-600 rounded-2xl flex items-center justify-center">
            <Monitor className="h-8 w-8 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">Agent Manager</h2>
          <p className="mt-2 text-sm text-gray-600">Sign in with your API key and project ID</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700">
                Agent API Key
              </label>
              <input
                id="apiKey"
                type="password"
                required
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Enter your API key"
              />
            </div>
            <div>
              <label htmlFor="projectId" className="block text-sm font-medium text-gray-700">
                Project ID
              </label>
              <input
                id="projectId"
                type="text"
                required
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g. clx1234567890abcdef"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {loading ? 'Connecting...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
