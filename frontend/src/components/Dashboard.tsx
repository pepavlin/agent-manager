import { useState, useEffect } from 'react';
import {
  Home,
  MessageSquare,
  Brain,
  FileText,
  MessagesSquare,
  Settings,
  LogOut,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Project, TabId } from '../lib/types';
import OverviewTab from './OverviewTab';
import ChatTab from './ChatTab';
import MemoryTab from './MemoryTab';
import DocumentsTab from './DocumentsTab';
import ThreadsTab from './ThreadsTab';
import ToolCallsTab from './ToolCallsTab';

interface Props {
  projectId: string;
  currentTab: TabId;
  onTabChange: (tab: TabId) => void;
  onLogout: () => void;
}

const NAV_ITEMS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'threads', label: 'Threads', icon: MessagesSquare },
  { id: 'tools', label: 'Tool Calls', icon: Settings },
];

export default function Dashboard({ projectId, currentTab, onTabChange, onLogout }: Props) {
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  async function loadProject() {
    try {
      const res = await apiFetch(`/api/project/${projectId}`);
      if (res.ok) setProject(await res.json());
    } catch (e) {
      console.error('Failed to load project', e);
    }
  }

  const tabLabel = NAV_ITEMS.find((i) => i.id === currentTab)?.label || '';

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-lg font-semibold truncate">{project?.name || 'Dashboard'}</h1>
          <p className="text-xs text-gray-400 mt-1 truncate">{projectId}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentTab === id
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-700">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900">{tabLabel}</h2>
        </div>

        <div className="p-6">
          {currentTab === 'overview' && <OverviewTab project={project} />}
          {currentTab === 'chat' && <ChatTab projectId={projectId} />}
          {currentTab === 'memory' && <MemoryTab projectId={projectId} />}
          {currentTab === 'documents' && <DocumentsTab projectId={projectId} />}
          {currentTab === 'threads' && <ThreadsTab projectId={projectId} />}
          {currentTab === 'tools' && <ToolCallsTab projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}
