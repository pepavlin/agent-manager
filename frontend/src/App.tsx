import { useState, useEffect } from 'react';
import { setApiKey } from './lib/api';
import type { TabId } from './lib/types';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [currentTab, setCurrentTab] = useState<TabId>('overview');

  useEffect(() => {
    const savedKey = sessionStorage.getItem('agentApiKey');
    const savedProject = sessionStorage.getItem('projectId');
    if (savedKey && savedProject) {
      setApiKey(savedKey);
      setProjectId(savedProject);
      setAuthenticated(true);
    }
  }, []);

  function handleLogin(apiKey: string, projId: string) {
    setApiKey(apiKey);
    setProjectId(projId);
    sessionStorage.setItem('agentApiKey', apiKey);
    sessionStorage.setItem('projectId', projId);
    setAuthenticated(true);
  }

  function handleLogout() {
    setAuthenticated(false);
    setProjectId('');
    setApiKey('');
    sessionStorage.removeItem('agentApiKey');
    sessionStorage.removeItem('projectId');
  }

  if (!authenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <Dashboard
      projectId={projectId}
      currentTab={currentTab}
      onTabChange={setCurrentTab}
      onLogout={handleLogout}
    />
  );
}
