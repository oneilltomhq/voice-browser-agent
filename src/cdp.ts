/**
 * Chrome DevTools Protocol wrapper for chrome.debugger API
 */

export class CDPSession {
  private tabId: number;
  private attached = false;

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  get target(): chrome.debugger.Debuggee {
    return { tabId: this.tabId };
  }

  get isAttached(): boolean {
    return this.attached;
  }

  async attach(protocolVersion = '1.3'): Promise<void> {
    if (this.attached) return;
    await chrome.debugger.attach(this.target, protocolVersion);
    this.attached = true;
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    try {
      await chrome.debugger.detach(this.target);
    } catch {
      // May already be detached
    }
    this.attached = false;
  }

  async send<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this.attached) {
      throw new Error('CDP session not attached');
    }
    const result = await chrome.debugger.sendCommand(this.target, method, params);
    return result as T;
  }

  /** Enable required CDP domains */
  async enableDomains(): Promise<void> {
    await Promise.all([
      this.send('Page.enable'),
      this.send('DOM.enable'),
      this.send('Accessibility.enable'),
      this.send('Runtime.enable'),
    ]);
  }
}

/** Singleton session manager */
class SessionManager {
  private sessions = new Map<number, CDPSession>();

  get(tabId: number): CDPSession | undefined {
    return this.sessions.get(tabId);
  }

  async getOrCreate(tabId: number): Promise<CDPSession> {
    let session = this.sessions.get(tabId);
    if (!session) {
      session = new CDPSession(tabId);
      this.sessions.set(tabId, session);
    }
    if (!session.isAttached) {
      await session.attach();
      await session.enableDomains();
    }
    return session;
  }

  async remove(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    if (session) {
      await session.detach();
      this.sessions.delete(tabId);
    }
  }

  clear(): void {
    for (const [tabId] of this.sessions) {
      this.remove(tabId);
    }
  }
}

export const sessionManager = new SessionManager();
