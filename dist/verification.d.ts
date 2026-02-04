/**
 * Uniplex MCP Server - Verification Module
 * Version: 1.0.0
 *
 * CRITICAL: This module implements local verification.
 * verifyLocally() MUST NOT make network calls.
 *
 * Cross-ref: MCP Server Spec Section 1.3 (Hot Path Rules)
 */
import { Passport, CachedCatalog, VerifyResult, RequestContext, RateLimiter } from './types.js';
export declare class InMemoryRateLimiter implements RateLimiter {
    private buckets;
    private limits;
    setLimit(action: string, max: number, windowMs?: number): void;
    private getBucketKey;
    check(action: string, passportId?: string): boolean;
    increment(action: string, passportId?: string): void;
    reset(action: string, passportId?: string): void;
}
/**
 * Verify passport signature using issuer's Ed25519 public key
 *
 * NORMATIVE: Passports are signed by issuers, verified with issuer keys.
 * Gates NEVER use their own keys for passport verification.
 */
export declare function verifySignature(passport: Passport, issuerPublicKey: string): Promise<boolean>;
/**
 * Synchronous signature verification for hot path
 * Uses cached key material
 */
export declare function verifySignatureSync(passport: Passport, issuerPublicKey: string): boolean;
interface ConstraintValidationResult {
    valid: boolean;
    message?: string;
}
/**
 * Validate passport constraints against request context
 *
 * Uses constraint type registry to determine merge behavior:
 * - 'limit' constraints: min-merge (most restrictive wins)
 * - 'term' constraints: gate-authoritative (catalog value used)
 */
export declare function validateConstraints(passportConstraints: Record<string, unknown>, context: RequestContext, catalogConstraints?: Record<string, unknown>): ConstraintValidationResult;
/**
 * Merge catalog and passport constraints
 *
 * - limit constraints: min(catalog, passport) - most restrictive wins
 * - term constraints: catalog value (gate-authoritative)
 */
export declare function mergeConstraints(catalogConstraints: Record<string, unknown>, passportConstraints: Record<string, unknown>): Record<string, unknown>;
export interface VerifyLocallyParams {
    passport: Passport | null;
    catalog: CachedCatalog;
    revocationList: Set<string>;
    issuerKeys: Record<string, string>;
    rateLimiter: RateLimiter;
    action: string;
    context: RequestContext;
    /** Skip signature verification (for testing only) */
    skipSignatureVerification?: boolean;
}
/**
 * LOCAL verification - no network calls.
 * This is the hot path that runs on every tool call.
 *
 * NORMATIVE (RFC 2119):
 * - MUST NOT make network calls
 * - MUST complete in sub-millisecond time
 * - MUST use cached data only
 *
 * Implements the 9-step algorithm from Section 1.3
 */
export declare function verifyLocally(params: VerifyLocallyParams): VerifyResult;
/**
 * Build claimsByKey index for O(1) permission lookup
 * MUST be called when loading a passport
 */
export declare function buildPassportIndex(passport: Omit<Passport, 'claimsByKey'>): Passport;
/**
 * Check if a passport has a specific permission (without full verification)
 */
export declare function hasPermission(passport: Passport | null, action: string): boolean;
/**
 * Get constraints for a specific permission from passport
 */
export declare function getPermissionConstraints(passport: Passport | null, action: string): Record<string, unknown> | undefined;
export {};
//# sourceMappingURL=verification.d.ts.map