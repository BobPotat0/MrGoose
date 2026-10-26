import { Injectable, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import type { TechniqueDto, AgentFileInfo } from './models';
import './models'; // pulls in the global window.mrgoose declaration

type Health = 'checking' | 'ok' | 'down';
type Hub = 'disconnected' | 'connecting' | 'connected';

export interface ChatMsg { role: 'user' | 'assistant' | 'system'; content: string; }

/** Owns the REST base + the SignalR connection to the C# sidecar; exposes state as signals. */
@Injectable({ providedIn: 'root' })
export class BackendService {
  readonly backendUrl = window.mrgoose?.backendUrl ?? 'http://127.0.0.1:5174';
  readonly inElectron = !!window.mrgoose;

  readonly health = signal<Health>('checking');
  readonly backendVersion = signal<string>('—');
  readonly hub = signal<Hub>('disconnected');
  readonly lastEvent = signal<string>('—');

  private connection?: signalR.HubConnection;
  private started = false;
  private pageActionHandler?: (a: { id: string; name: string; args: string }) => void;

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.checkHealth();
    await this.connectHub();
  }

  async checkHealth(): Promise<void> {
    this.health.set('checking');
    try {
      const res = await fetch(`${this.backendUrl}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      this.backendVersion.set(body.version ?? '—');
      this.health.set('ok');
    } catch {
      this.health.set('down');
    }
  }

  private async connectHub(): Promise<void> {
    this.hub.set('connecting');
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${this.backendUrl}/hub/agent`)
      .withAutomaticReconnect()
      .build();

    this.connection.on('agentPageAction', (a: { id: string; name: string; args: string }) => this.pageActionHandler?.(a));
    this.connection.on('welcome', (p: { utc: string }) => this.lastEvent.set(`welcome · ${this.time(p.utc)}`));
    this.connection.on('pong', (p: { echo: string; utc: string }) => this.lastEvent.set(`pong "${p.echo}" · ${this.time(p.utc)}`));
    this.connection.onreconnecting(() => this.hub.set('connecting'));
    this.connection.onreconnected(() => this.hub.set('connected'));
    this.connection.onclose(() => this.hub.set('disconnected'));

    try {
      await this.connection.start();
      this.hub.set('connected');
      await this.connection.invoke('Ping', 'hello from cockpit');
    } catch {
      this.hub.set('disconnected');
    }
  }

  /** Run the crafter tool-loop. Tokens → onToken; tool activity → onTool; completion → onDone(ok). */
  async sendChat(
    req: { scenarioCode: string; modelName: string; systemPrompt: string; messages: ChatMsg[] },
    onToken: (t: string) => void,
    onTool: (name: string, args: string) => void,
    onDone: (ok: boolean) => void,
    onReasoning?: (t: string) => void,
  ): Promise<void> {
    if (!this.connection || this.hub() !== 'connected') { onDone(false); return; }
    const onTok = (t: string) => onToken(t);
    const onReas = (t: string) => onReasoning?.(t);
    const onToolEv = (p: { name: string; args: string }) => onTool(p.name, p.args);
    const onFin = (r: { ok: boolean }) => {
      this.connection!.off('chatToken', onTok);
      this.connection!.off('chatReasoning', onReas);
      this.connection!.off('chatTool', onToolEv);
      this.connection!.off('chatDone', onFin);
      onDone(!!r?.ok);
    };
    this.connection.on('chatToken', onTok);
    this.connection.on('chatReasoning', onReas);
    this.connection.on('chatTool', onToolEv);
    this.connection.on('chatDone', onFin);
    try {
      await this.connection.invoke('ChatSend', req);
    } catch {
      onFin({ ok: false });
    }
  }

  /** Mr Goose Agent: tool-using loop over the whole app. Tokens → onToken, reasoning → onReasoning, tools → onTool. */
  async agentChat(messages: ChatMsg[], onToken: (t: string) => void, onTool: (name: string, args: string) => void, onDone: (ok: boolean) => void, onReasoning?: (t: string) => void, onTechniques?: (rows: TechniqueDto[]) => void, onFile?: (file: AgentFileInfo) => void, sessionId?: string): Promise<void> {
    if (!this.connection || this.hub() !== 'connected') { onDone(false); return; }
    const onTok = (t: string) => onToken(t);
    const onReas = (t: string) => onReasoning?.(t);
    const onToolEv = (p: { name: string; args: string }) => onTool(p.name, p.args);
    const onTable = (rows: TechniqueDto[]) => onTechniques?.(rows);
    const onFileEvent = (file: AgentFileInfo) => onFile?.(file);
    let finished = false;
    const onFin = (r: { ok: boolean }) => {
      if (finished) return;
      finished = true;
      this.connection!.off('agentFile', onFileEvent);
      this.connection!.off('agentTechniques', onTable);
      this.connection!.off('agentToken', onTok);
      this.connection!.off('agentReasoning', onReas);
      this.connection!.off('agentTool', onToolEv);
      this.connection!.off('agentDone', onFin);
      onDone(!!r?.ok);
    };
    this.connection.on('agentFile', onFileEvent);
    this.connection.on('agentTechniques', onTable);
    this.connection.on('agentToken', onTok);
    this.connection.on('agentReasoning', onReas);
    this.connection.on('agentTool', onToolEv);
    this.connection.on('agentDone', onFin);
    try { await this.connection.invoke('AgentChat', messages, sessionId ?? null); } catch { onFin({ ok: false }); }
  }

  /** Register a handler for agent page actions (the agent asks the client to fill/read the arena). */
  onAgentPageAction(handler: (a: { id: string; name: string; args: string }) => void): void {
    this.pageActionHandler = handler;
  }
  agentPageResult(id: string, result: string): void {
    this.connection?.invoke('AgentPageResult', id, result).catch(() => {});
  }

  /** Stream the next direct-jailbreak instructor prompt for a Finder hunt. */
  async finderCraft(sessionId: number, onToken: (t: string) => void, onDone: (ok: boolean) => void): Promise<void> {
    if (!this.connection || this.hub() !== 'connected') { onDone(false); return; }
    const onTok = (t: string) => onToken(t);
    const onFin = (r: { ok: boolean }) => {
      this.connection!.off('finderToken', onTok);
      this.connection!.off('finderDone', onFin);
      onDone(!!r?.ok);
    };
    this.connection.on('finderToken', onTok);
    this.connection.on('finderDone', onFin);
    try { await this.connection.invoke('FinderCraft', sessionId); }
    catch { onFin({ ok: false }); }
  }

  private time(utc: string): string {
    const d = new Date(utc);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
  }
}
