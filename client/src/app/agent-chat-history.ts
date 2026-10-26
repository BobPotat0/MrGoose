import type { ChatMsg } from './backend.service';
import type { TechniqueDto, AgentFileInfo } from './models';

export type ViewItem = { type: 'user' | 'assistant' | 'tool' | 'techniques' | 'file'; text: string; reasoning?: string; reasoningOpen?: boolean; techniques?: TechniqueDto[]; file?: AgentFileInfo };
export interface AgentConversation {
  id: string;
  title: string;
  titleSource?: 'auto' | 'custom';
  updatedAt: string;
  view: ViewItem[];
  messages: ChatMsg[];
  running: boolean;
}
export interface AgentHistory { version: 1; activeId: string; sessions: AgentConversation[]; }

/** Validate saved data before restoring it; never replace unreadable history with an empty save. */
export function readAgentHistory(raw: string | null): AgentHistory | null {
  if (raw === null) return null;
  const data = JSON.parse(raw);
  const str = (v: unknown) => typeof v === 'string';
  const row = (t: any) => t && Number.isInteger(t.id) && ['title', 'summary', 'whenItWorks', 'example', 'tags'].every(k => str(t[k])) && typeof t.builtin === 'boolean';
  const item = (v: any) => v && ['user', 'assistant', 'tool', 'techniques', 'file'].includes(v.type) && str(v.text)
    && (v.reasoning === undefined || str(v.reasoning)) && (v.reasoningOpen === undefined || typeof v.reasoningOpen === 'boolean')
    && (v.type !== 'techniques' || (Array.isArray(v.techniques) && v.techniques.every(row)))
    && (v.type !== 'file' || (v.file && str(v.file.id) && str(v.file.name) && Number.isFinite(v.file.size) && str(v.file.createdAt)));
  const session = (s: any) => s && str(s.id) && str(s.title) && str(s.updatedAt) && typeof s.running === 'boolean'
    && (s.titleSource === undefined || ['auto', 'custom'].includes(s.titleSource))
    && Array.isArray(s.view) && s.view.every(item) && Array.isArray(s.messages)
    && s.messages.every((m: any) => m && ['user', 'assistant'].includes(m.role) && str(m.content));
  if (data?.version !== 1 || !str(data.activeId) || !Array.isArray(data.sessions) || !data.sessions.every(session)
    || new Set(data.sessions.map((s: AgentConversation) => s.id)).size !== data.sessions.length) {
    throw new Error('Invalid agent chat history');
  }
  return data;
}

/** Neutral local title; creating a chat never requires another model request. */
export function sessionTitle(timestamp: string): string {
  const parsed = new Date(timestamp);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `Session · ${date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}
