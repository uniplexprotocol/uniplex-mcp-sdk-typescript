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
export declare class SessionManager {
    private sessions;
    private safeDefaultConfig;
    private apiUrl;
    private gateId;
    private gateSecret?;
    constructor(config: {
        safe_default: SafeDefaultConfig;
        uniplex_api_url: string;
        gate_id: string;
        gate_secret?: string;
    });
    getOrCreateSession(sessionId: string, meta?: {
        agentId?: string;
        issuerId?: string;
    }): Promise<Session>;
    getSession(sessionId: string): Session | undefined;
    deleteSession(sessionId: string): boolean;
    listSessions(): Session[];
    setPassport(sessionId: string, passport: Passport): void;
    getPassport(sessionId: string): Passport | null;
    clearPassport(sessionId: string): void;
    sessionHasPermission(sessionId: string, action: string): boolean;
    getSessionPermissions(sessionId: string): string[];
    getSessionConstraints(sessionId: string, action?: string): Record<string, unknown> | undefined;
    /**
     * Issue a safe default passport for a new session.
     * This is a NETWORK call and happens at session bootstrap, NOT hot path.
     */
    private issueSafeDefault;
    /**
     * Remove sessions that have been inactive for too long
     */
    cleanupInactiveSessions(maxInactiveMs?: number): number;
    /**
     * Remove sessions with expired passports
     */
    cleanupExpiredPassports(): number;
}
export declare class SessionWrapper {
    private session;
    constructor(session: Session);
    get passport(): Passport | null;
    get sessionId(): string;
    hasPermission(action: string): boolean;
    getPermissions(): string[];
    getConstraints(action?: string): Record<string, unknown> | undefined;
    get passportId(): string | undefined;
    get agentId(): string | undefined;
    get expiresAt(): string | undefined;
}
/**
 * Create a test session with a mock passport
 * For use in test mode
 */
export declare function createTestSession(sessionId: string, permissions: string[], constraints?: Record<string, unknown>): Session;
//# sourceMappingURL=session.d.ts.map