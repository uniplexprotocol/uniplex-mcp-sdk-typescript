/**
 * Uniplex MCP Server - Session Module
 * Version: 1.0.0
 * 
 * Manages MCP sessions with passport tracking.
 * Sessions persist passports in memory for tool calls.
 * 
 * Cross-ref: MCP Server Spec Section 5.2 (Session Management)
 */

import { Session, Passport, SafeDefaultConfig } from './types.js';
import { buildPassportIndex, hasPermission, getPermissionConstraints } from './verification.js';

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private safeDefaultConfig: SafeDefaultConfig;
  private apiUrl: string;
  private gateId: string;
  private gateSecret?: string;
  
  constructor(config: {
    safe_default: SafeDefaultConfig;
    uniplex_api_url: string;
    gate_id: string;
    gate_secret?: string;
  }) {
    this.safeDefaultConfig = config.safe_default;
    this.apiUrl = config.uniplex_api_url;
    this.gateId = config.gate_id;
    this.gateSecret = config.gate_secret;
  }
  
  // ==========================================================================
  // SESSION CRUD
  // ==========================================================================
  
  async getOrCreateSession(
    sessionId: string,
    meta?: { agentId?: string; issuerId?: string }
  ): Promise<Session> {
    let session = this.sessions.get(sessionId);
    
    if (session) {
      session.last_activity = Date.now();
      return session;
    }
    
    // Create new session
    session = {
      session_id: sessionId,
      passport: null,
      created_at: Date.now(),
      last_activity: Date.now(),
    };
    
    // Auto-issue safe default passport if configured
    if (this.safeDefaultConfig.enabled && this.safeDefaultConfig.auto_issue) {
      try {
        const passport = await this.issueSafeDefault(meta?.agentId, meta?.issuerId);
        session.passport = passport;
      } catch (error) {
        console.error('Failed to issue safe default passport:', error);
        // Continue without passport - session will have null passport
      }
    }
    
    this.sessions.set(sessionId, session);
    return session;
  }
  
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }
  
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
  
  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }
  
  // ==========================================================================
  // PASSPORT MANAGEMENT
  // ==========================================================================
  
  setPassport(sessionId: string, passport: Passport): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Ensure claimsByKey is built
      session.passport = buildPassportIndex(passport);
      session.last_activity = Date.now();
    }
  }
  
  getPassport(sessionId: string): Passport | null {
    return this.sessions.get(sessionId)?.passport ?? null;
  }
  
  clearPassport(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.passport = null;
      session.last_activity = Date.now();
    }
  }
  
  // ==========================================================================
  // PERMISSION QUERIES (uses session's passport)
  // ==========================================================================
  
  sessionHasPermission(sessionId: string, action: string): boolean {
    const passport = this.getPassport(sessionId);
    return hasPermission(passport, action);
  }
  
  getSessionPermissions(sessionId: string): string[] {
    const passport = this.getPassport(sessionId);
    if (!passport) return [];
    return passport.permissions.map(p => p.permission_key);
  }
  
  getSessionConstraints(
    sessionId: string,
    action?: string
  ): Record<string, unknown> | undefined {
    const passport = this.getPassport(sessionId);
    if (!passport) return undefined;
    
    if (action) {
      return getPermissionConstraints(passport, action);
    }
    
    return passport.constraints;
  }
  
  // ==========================================================================
  // SAFE DEFAULT PASSPORT ISSUANCE
  // ==========================================================================
  
  /**
   * Issue a safe default passport for a new session.
   * This is a NETWORK call and happens at session bootstrap, NOT hot path.
   */
  private async issueSafeDefault(
    agentId?: string,
    issuerId?: string
  ): Promise<Passport> {
    const response = await fetch(
      `${this.apiUrl}/gates/${this.gateId}/passports/safe-default`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.gateSecret && { 'Authorization': `Bearer ${this.gateSecret}` }),
        },
        body: JSON.stringify({
          agent_id: agentId ?? `agent_anon_${Date.now()}`,
          issuer_id: issuerId,
          permissions: this.safeDefaultConfig.permissions,
          constraints: this.safeDefaultConfig.constraints,
          max_lifetime: this.safeDefaultConfig.max_lifetime,
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Safe default issuance failed: ${response.status}`);
    }
    
    const data = await response.json() as { passport: Passport };
    return buildPassportIndex(data.passport);
  }
  
  // ==========================================================================
  // SESSION CLEANUP
  // ==========================================================================
  
  /**
   * Remove sessions that have been inactive for too long
   */
  cleanupInactiveSessions(maxInactiveMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.last_activity > maxInactiveMs) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * Remove sessions with expired passports
   */
  cleanupExpiredPassports(): number {
    const now = new Date();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.passport && new Date(session.passport.expires_at) < now) {
        session.passport = null;
        cleaned++;
      }
    }
    
    return cleaned;
  }
}

// =============================================================================
// SESSION WRAPPER CLASS (used by MCP Server handlers)
// =============================================================================

export class SessionWrapper {
  constructor(private session: Session) {}
  
  get passport(): Passport | null {
    return this.session.passport;
  }
  
  get sessionId(): string {
    return this.session.session_id;
  }
  
  hasPermission(action: string): boolean {
    return hasPermission(this.session.passport, action);
  }
  
  getPermissions(): string[] {
    if (!this.session.passport) return [];
    return this.session.passport.permissions.map(p => p.permission_key);
  }
  
  getConstraints(action?: string): Record<string, unknown> | undefined {
    if (!this.session.passport) return undefined;
    
    if (action) {
      return getPermissionConstraints(this.session.passport, action);
    }
    
    return this.session.passport.constraints;
  }
  
  get passportId(): string | undefined {
    return this.session.passport?.passport_id;
  }
  
  get agentId(): string | undefined {
    return this.session.passport?.agent_id;
  }
  
  get expiresAt(): string | undefined {
    return this.session.passport?.expires_at;
  }
}

// =============================================================================
// TEST SESSION HELPER
// =============================================================================

/**
 * Create a test session with a mock passport
 * For use in test mode
 */
export function createTestSession(
  sessionId: string,
  permissions: string[],
  constraints: Record<string, unknown> = {}
): Session {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  
  const mockPassport: Omit<Passport, 'claimsByKey'> = {
    passport_id: `passport_test_${sessionId}`,
    issuer_id: 'issuer_test',
    agent_id: `agent_test_${sessionId}`,
    gate_id: 'gate_test',
    permissions: permissions.map(key => ({
      permission_key: key,
      constraints: {},
    })),
    constraints,
    signature: '0'.repeat(128), // Mock signature
    expires_at: expiresAt.toISOString(),
    issued_at: now.toISOString(),
  };
  
  return {
    session_id: sessionId,
    passport: buildPassportIndex(mockPassport),
    created_at: now.getTime(),
    last_activity: now.getTime(),
  };
}
