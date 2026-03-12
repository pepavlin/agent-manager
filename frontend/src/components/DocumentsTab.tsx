import { useState, useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { DocumentItem } from '../lib/types';

interface Props {
  projectId: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  FACTS: 'bg-blue-100 text-blue-800',
  RULES: 'bg-purple-100 text-purple-800',
  STATE: 'bg-orange-100 text-orange-800',
};

export default function DocumentsTab({ projectId }: Props) {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [category, setCategory] = useState('FACTS');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState('');
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadDocuments(); }, [projectId]);

  async function loadDocuments() {
    try {
      const res = await apiFetch(`/api/project/${projectId}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.items);
      }
    } catch (e) {
      console.error('Failed to load documents', e);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const files = fileRef.current?.files;
    if (!files?.length) return;

    setUploading(true);
    setUploadResult('');
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', files[0]);
      formData.append('category', category);

      const res = await apiFetch(`/projects/${projectId}/docs`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setUploadResult(`Uploaded ${data.filename} (${data.chunks_count} chunks)`);
        if (fileRef.current) fileRef.current.value = '';
        loadDocuments();
      } else {
        const data = await res.json();
        setUploadError(data.error || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fade-in space-y-6">
      {/* Upload */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Upload Document
        </h3>
        <form onSubmit={handleUpload} className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">File</label>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf"
              className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="FACTS">FACTS</option>
              <option value="RULES">RULES</option>
              <option value="STATE">STATE</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
        {uploadResult && <div className="mt-3 text-sm text-green-600">{uploadResult}</div>}
        {uploadError && <div className="mt-3 text-sm text-red-600">{uploadError}</div>}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chunks</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {documents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-400 text-sm">
                  No documents uploaded
                </td>
              </tr>
            )}
            {documents.map((doc) => (
              <tr key={doc.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-sm text-gray-900">{doc.filename}</td>
                <td className="px-6 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[doc.category]}`}>
                    {doc.category}
                  </span>
                </td>
                <td className="px-6 py-3 text-sm text-gray-500">{doc.chunks_count}</td>
                <td className="px-6 py-3 text-sm text-gray-500">v{doc.version}</td>
                <td className="px-6 py-3 text-sm text-gray-500">{formatDate(doc.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
