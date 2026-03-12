export interface Project {
  id: string;
  name: string;
  role_statement: string;
  created_at: string;
  updated_at: string;
  counts: {
    documents: number;
    threads: number;
    memory_items: number;
  };
  brief: {
    brief_markdown: string;
    kb_index_markdown: string;
    updated_at: string;
  } | null;
}

export interface ThreadSummary {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: {
    role: string;
    content: string;
    created_at: string;
  } | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: string;
}

export interface ThreadDetail {
  id: string;
  user_id: string;
  created_at: string;
  messages: Message[];
}

export interface MemoryItem {
  id: string;
  type: string;
  title: string;
  content: Record<string, unknown>;
  status: string;
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  tags: string[];
}

export interface DocumentItem {
  id: string;
  category: 'FACTS' | 'RULES' | 'STATE';
  filename: string;
  mime: string;
  version: number;
  chunks_count: number;
  created_at: string;
}

export interface ToolCallItem {
  id: string;
  name: string;
  args: Record<string, unknown>;
  requires_approval: boolean;
  risk: 'low' | 'medium' | 'high';
  status: string;
  result: Record<string, unknown> | null;
  created_at: string;
}

export type TabId = 'overview' | 'chat' | 'memory' | 'documents' | 'threads' | 'tools';
