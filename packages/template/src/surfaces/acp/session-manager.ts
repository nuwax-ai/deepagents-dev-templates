/**
 * ACP Session Manager
 *
 * Tracks active ACP sessions and provides close/list operations that
 * deepagents-acp does not natively support. Pure in-memory bookkeeping; the
 * lifecycle patching that drives it lives in `session-lifecycle.ts`.
 */

import { logger } from "../../runtime/logger.js";

export interface SessionInfo {
  sessionId: string;
  createdAt: string;
  lastActivityAt: string;
  mode: string;
  messageCount: number;
}

/**
 * Session lifecycle manager. Tracks active sessions and provides
 * close/list operations that deepagents-acp doesn't natively support.
 */
export class SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private log = logger.child("session-manager");

  track(sessionId: string, mode: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      mode,
      messageCount: 0,
    });
    this.log.debug("Session tracked", { sessionId, mode, total: this.sessions.size });
  }

  touch(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (info) {
      info.lastActivityAt = new Date().toISOString();
      info.messageCount++;
    }
  }

  close(sessionId: string): SessionInfo | undefined {
    const info = this.sessions.get(sessionId);
    if (info) {
      this.sessions.delete(sessionId);
      this.log.info("Session closed", { sessionId, messages: info.messageCount });
    }
    return info;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get count(): number {
    return this.sessions.size;
  }
}
