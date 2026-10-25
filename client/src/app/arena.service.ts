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
  create(url?: string): Promise<string | undefined> { return this.m?.tabs.create(url) ?? Promise.resolve(undefined); }
  select(id: string): Promise<ArenaTab[]> { return this.m?.tabs.select(id) ?? Promise.resolve([]); }
  close(id: string): Promise<ArenaTab[]> { return this.m?.tabs.close(id) ?? Promise.resolve([]); }
  loadUrl(id: string, url: string) { return this.m?.tabs.loadUrl(id, url) ?? Promise.resolve(false); }
  setBounds(rect: { x: number; y: number; width: number; height: number }) { return this.m?.tabs.setBounds(rect) ?? Promise.resolve(false); }
  setVisible(visible: boolean) { return this.m?.tabs.setVisible(visible) ?? Promise.resolve(false); }

  fill(selector: string, value: string): Promise<BridgeResult> { return this.m?.bridge.fillField(selector, value) ?? Promise.resolve(NOT_ELECTRON); }
  read(selector: string): Promise<BridgeResult> { return this.m?.bridge.readDom(selector) ?? Promise.resolve(NOT_ELECTRON); }
  snapshot(selector?: string): Promise<BridgeResult> { return this.m?.bridge.snapshotConversation(selector) ?? Promise.resolve(NOT_ELECTRON); }
  highlight(selector: string): Promise<BridgeResult> { return this.m?.bridge.highlightSendButton(selector) ?? Promise.resolve(NOT_ELECTRON); }
  pick(): Promise<BridgeResult> { return this.m?.bridge.pickElement() ?? Promise.resolve(NOT_ELECTRON); }
}
