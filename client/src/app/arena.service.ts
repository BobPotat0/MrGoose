import { Injectable } from '@angular/core';
import { ArenaTab, BridgeResult } from './models';

const NOT_ELECTRON: BridgeResult = { ok: false, note: 'arena bridge only available in the Electron app' };

/**
 * Wraps the Electron page bridge (window.mrgoose). FILL + READ only — there is no send/launch/submit
 * method here, matching the main-process bridge and the Gray Swan Rule of Engagement.
 */
@Injectable({ providedIn: 'root' })
export class ArenaService {
  private get m() { return window.mrgoose; }
  readonly available = !!window.mrgoose?.tabs;

  list(): Promise<ArenaTab[]> { return this.m?.tabs.list() ?? Promise.resolve([]); }
  show() { return this.m?.tabs.show?.() ?? Promise.resolve(); }
  create(url?: string): Promise<string | undefined> { return this.m?.tabs.create(url) ?? Promise.resolve(undefined); }
  select(id: string): Promise<ArenaTab[]> { return this.m?.tabs.select(id) ?? Promise.resolve([]); }
  close(id: string): Promise<ArenaTab[]> { return this.m?.tabs.close(id) ?? Promise.resolve([]); }
  loadUrl(id: string, url: string) { return this.m?.tabs.loadUrl(id, url) ?? Promise.resolve(false); }
  setBounds(rect: { x: number; y: number; width: number; height: number }) { return this.m?.tabs.setBounds(rect) ?? Promise.resolve(false); }
  setVisible(visible: boolean) { return this.m?.tabs.setVisible(visible) ?? Promise.resolve(false); }
  detach(): Promise<{ docked: boolean }> { return this.m?.tabs.detach?.() ?? Promise.resolve({ docked: true }); }
  dock(): Promise<{ docked: boolean }> { return this.m?.tabs.dock?.() ?? Promise.resolve({ docked: true }); }
  state(): Promise<{ docked: boolean }> { return this.m?.tabs.state?.() ?? Promise.resolve({ docked: true }); }
  onDocked(callback: (s: { docked: boolean }) => void) { return this.m?.tabs.onDocked?.(callback) ?? (() => {}); }

  onChanged(callback: (tabs: ArenaTab[]) => void) { return this.m?.tabs.onChanged?.(callback) ?? (() => {}); }
  // UI captures its current selection once. Agent/MCP callers pass their explicit tab ID.
  private async target(tabId?: string) { return tabId ?? (await this.list()).find(t => t.active)?.id; }
  async fill(selector: string, value: string, tabId?: string): Promise<BridgeResult> { const id = await this.target(tabId); return id && this.m ? this.m.bridge.fillField(id, selector, value) : NOT_ELECTRON; }
  async read(selector: string, tabId?: string): Promise<BridgeResult> { const id = await this.target(tabId); return id && this.m ? this.m.bridge.readDom(id, selector) : NOT_ELECTRON; }
  async snapshot(selector?: string, tabId?: string): Promise<BridgeResult> { const id = await this.target(tabId); return id && this.m ? this.m.bridge.snapshotConversation(id, selector) : NOT_ELECTRON; }
  async highlight(selector: string, tabId?: string): Promise<BridgeResult> { const id = await this.target(tabId); return id && this.m ? this.m.bridge.highlightSendButton(id, selector) : NOT_ELECTRON; }
  async pick(tabId?: string): Promise<BridgeResult> { const id = await this.target(tabId); return id && this.m ? this.m.bridge.pickElement(id) : NOT_ELECTRON; }
}
