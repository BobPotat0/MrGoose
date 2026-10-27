import { Injectable, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import type { TechniqueDto, OrganizerFileInfo } from './models';
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
  // Persistent inspector push: the in-app agent and MCP both emit organizerOpen/organizerChanged.
  private openHandlers: Array<(i: { kind: string; id: string }) => void> = [];
  private changeHandlers: Array<(i: { kind: string; id: string }) => void> = [];
  onOrganizerOpen(cb: (i: { kind: string; id: string }) => void) { this.openHandlers.push(cb); return () => { this.openHandlers = this.openHandlers.filter(h => h !== cb); }; }
  onOrganizerChanged(cb: (i: { kind: string; id: string }) => void) { this.changeHandlers.push(cb); return () => { this.changeHandlers = this.changeHandlers.filter(h => h !== cb); }; }

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.checkHealth();
    await this.connectHub();
  }

  async checkHealth(): Promise<void> {
    this.health.set('checking');
    try {
      const res = await fetch(`${this.backendUrl}/health`, { headers: window.mrgoose?.backendToken ? { Authorization: `Bearer ${window.mrgoose.backendToken}` } : {} });
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
      .withUrl(`${this.backendUrl}/hub/cockpit`, { accessTokenFactory: () => window.mrgoose?.backendToken || '' })
      .withAutomaticReconnect()
      .build();

    this.connection.on('organizerPageAction', (a: { id: string; name: string; args: string }) => this.pageActionHandler?.(a));
    this.connection.on('welcome', (p: { utc: string }) => this.lastEvent.set(`welcome · ${this.time(p.utc)}`));
    this.connection.on('pong', (p: { echo: string; utc: string }) => this.lastEvent.set(`pong "${p.echo}" · ${this.time(p.utc)}`));
    this.connection.on('organizerOpen', (i: { kind: string; id: string }) => this.openHandlers.forEach(h => h(i)));
    this.connection.on('organizerChanged', (i: { kind: string; id: string }) => this.changeHandlers.forEach(h => h(i)));
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

  /** Run the attacker tool-loop. Tokens → onToken; tool activity → onTool; completion → onDone(ok). */
  async attackerSend(
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
      this.connection!.off('attackerToken', onTok);
      this.connection!.off('attackerReasoning', onReas);
      this.connection!.off('attackerTool', onToolEv);
      this.connection!.off('attackerDone', onFin);
      onDone(!!r?.ok);
    };
    this.connection.on('attackerToken', onTok);
    this.connection.on('attackerReasoning', onReas);
    this.connection.on('attackerTool', onToolEv);
    this.connection.on('attackerDone', onFin);
    try {
      await this.connection.invoke('AttackerSend', req);
    } catch {
      onFin({ ok: false });
    }
  }

  /** Mr Goose Organizer: tool-using loop over the whole app. Tokens → onToken, reasoning → onReasoning, tools → onTool. */
  async organizerChat(messages: ChatMsg[], onToken: (t: string) => void, onTool: (name: string, args: string) => void, onDone: (ok: boolean) => void, onReasoning?: (t: string) => void, onTechniques?: (rows: TechniqueDto[]) => void, onFile?: (file: OrganizerFileInfo) => void, sessionId?: string): Promise<void> {
    if (!this.connection || this.hub() !== 'connected') { onDone(false); return; }
    const onTok = (t: string) => onToken(t);
    const onReas = (t: string) => onReasoning?.(t);
    const onToolEv = (p: { name: string; args: string }) => onTool(p.name, p.args);
    const onTable = (rows: TechniqueDto[]) => onTechniques?.(rows);
    const onFileEvent = (file: OrganizerFileInfo) => onFile?.(file);
    let finished = false;
    const onFin = (r: { ok: boolean }) => {
      if (finished) return;
      finished = true;
      this.connection!.off('organizerFile', onFileEvent);
      this.connection!.off('organizerTechniques', onTable);
      this.connection!.off('organizerToken', onTok);
      this.connection!.off('organizerReasoning', onReas);
      this.connection!.off('organizerTool', onToolEv);
      this.connection!.off('organizerDone', onFin);
      onDone(!!r?.ok);
    };
    this.connection.on('organizerFile', onFileEvent);
    this.connection.on('organizerTechniques', onTable);
    this.connection.on('organizerToken', onTok);
    this.connection.on('organizerReasoning', onReas);
    this.connection.on('organizerTool', onToolEv);
    this.connection.on('organizerDone', onFin);
    try { await this.connection.invoke('OrganizerChat', messages, sessionId ?? null); } catch { onFin({ ok: false }); }
  }

  /** Register a handler for agent page actions (the agent asks the client to fill/read the arena). */
  onOrganizerPageAction(handler: (a: { id: string; name: string; args: string }) => void): void {
    this.pageActionHandler = handler;
  }
  organizerPageResult(id: string, result: string): void {
    this.connection?.invoke('OrganizerPageResult', id, result).catch(() => {});
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
