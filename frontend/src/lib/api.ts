let apiKey = '';

export function setApiKey(key: string) {
  apiKey = key;
}

export function getApiKey() {
  return apiKey;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'X-AGENT-KEY': apiKey,
    ...(options.headers as Record<string, string> || {}),
  };

  // Don't set Content-Type for FormData
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    sessionStorage.removeItem('agentApiKey');
    window.location.reload();
    throw new Error('Unauthorized');
  }

  return res;
}
