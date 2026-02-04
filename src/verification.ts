/**
 * Uniplex MCP Server - Verification Module
 * Version: 1.0.0
 * 
 * CRITICAL: This module implements local verification.
 * verifyLocally() MUST NOT make network calls.
 * 
 * Cross-ref: MCP Server Spec Section 1.3 (Hot Path Rules)
 */

import * as ed from '@noble/ed25519';
import {
  Passport,
  CachedCatalog,
  CatalogVersion,
  CatalogPermission,
  VerifyResult,
  VerifyDenial,
  RequestContext,
  RateLimiter,
  CONSTRAINT_TYPES,
} from './types.js';

// =============================================================================
// RATE LIMITER (LOCAL, IN-MEMORY)
// =============================================================================

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private buckets: Map<string, RateLimitBucket> = new Map();
  private limits: Map<string, { max: number; windowMs: number }> = new Map();
  
  setLimit(action: string, max: number, windowMs: number = 60000): void {
    this.limits.set(action, { max, windowMs });
  }
  
  private getBucketKey(action: string, passportId?: string): string {
    return passportId ? `${action}:${passportId}` : action;
  }
  
  check(action: string, passportId?: string): boolean {
    const limit = this.limits.get(action);
    if (!limit) return true; // No limit configured
    
    const key = this.getBucketKey(action, passportId);
    const bucket = this.buckets.get(key);
    const now = Date.now();
    
    if (!bucket || bucket.resetAt <= now) {
      return true; // No bucket or expired
    }
    
    return bucket.count < limit.max;
  }
  
  increment(action: string, passportId?: string): void {
    const limit = this.limits.get(action);
    if (!limit) return;
    
    const key = this.getBucketKey(action, passportId);
    const now = Date.now();
    let bucket = this.buckets.get(key);
    
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + limit.windowMs };
      this.buckets.set(key, bucket);
    }
    
    bucket.count++;
  }
  
  reset(action: string, passportId?: string): void {
    const key = this.getBucketKey(action, passportId);
    this.buckets.delete(key);
  }
}

// =============================================================================
// SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify passport signature using issuer's Ed25519 public key
 * 
 * NORMATIVE: Passports are signed by issuers, verified with issuer keys.
 * Gates NEVER use their own keys for passport verification.
 */
export async function verifySignature(
  passport: Passport,
  issuerPublicKey: string
): Promise<boolean> {
  try {
    // Reconstruct the signed payload (canonical JSON without signature)
    const signedPayload = {
      passport_id: passport.passport_id,
      issuer_id: passport.issuer_id,
      agent_id: passport.agent_id,
      gate_id: passport.gate_id,
      permissions: passport.permissions,
      constraints: passport.constraints,
      expires_at: passport.expires_at,
      issued_at: passport.issued_at,
      catalog_version_pin: passport.catalog_version_pin,
    };
    
    // Remove undefined fields for canonical form
    const canonicalPayload = JSON.stringify(signedPayload, (_, v) => v === undefined ? undefined : v);
    
    const message = new TextEncoder().encode(canonicalPayload);
    const signature = hexToBytes(passport.signature);
    const publicKey = hexToBytes(issuerPublicKey);
    
    return await ed.verifyAsync(signature, message, publicKey);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Synchronous signature verification for hot path
 * Uses cached key material
 */
export function verifySignatureSync(
  passport: Passport,
  issuerPublicKey: string
): boolean {
  try {
    const signedPayload = {
      passport_id: passport.passport_id,
      issuer_id: passport.issuer_id,
      agent_id: passport.agent_id,
      gate_id: passport.gate_id,
      permissions: passport.permissions,
      constraints: passport.constraints,
      expires_at: passport.expires_at,
      issued_at: passport.issued_at,
      catalog_version_pin: passport.catalog_version_pin,
    };
    
    const canonicalPayload = JSON.stringify(signedPayload, (_, v) => v === undefined ? undefined : v);
    const message = new TextEncoder().encode(canonicalPayload);
    const signature = hexToBytes(passport.signature);
    const publicKey = hexToBytes(issuerPublicKey);
    
    // ed.verify is synchronous
    return ed.verify(signature, message, publicKey);
  } catch (error) {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// =============================================================================
// CONSTRAINT VALIDATION
// =============================================================================

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
export function validateConstraints(
  passportConstraints: Record<string, unknown>,
  context: RequestContext,
  catalogConstraints?: Record<string, unknown>
): ConstraintValidationResult {
  for (const [key, passportValue] of Object.entries(passportConstraints)) {
    const contextValue = context[key];
    
    // Skip if no context value for this constraint
    if (contextValue === undefined) continue;
    
    const constraintType = CONSTRAINT_TYPES[key];
    
    // For limit constraints, check if context exceeds passport limit
    if (constraintType?.type === 'limit' && typeof passportValue === 'number') {
      const contextNum = typeof contextValue === 'number' 
        ? contextValue 
        : Number(contextValue);
      
      if (isNaN(contextNum)) {
        return { valid: false, message: `Invalid context value for ${key}` };
      }
      
      if (contextNum > passportValue) {
        return { 
          valid: false, 
          message: `Constraint ${key} exceeded: ${contextNum} > ${passportValue}` 
        };
      }
    }
    
    // For term constraints, they are informational only (not enforced here)
    // Commerce enforcement happens in the billing layer
  }
  
  return { valid: true };
}

/**
 * Merge catalog and passport constraints
 * 
 * - limit constraints: min(catalog, passport) - most restrictive wins
 * - term constraints: catalog value (gate-authoritative)
 */
export function mergeConstraints(
  catalogConstraints: Record<string, unknown>,
  passportConstraints: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...catalogConstraints };
  
  for (const [key, passportValue] of Object.entries(passportConstraints)) {
    const constraintType = CONSTRAINT_TYPES[key];
    
    if (constraintType?.type === 'limit' && typeof passportValue === 'number') {
      // min-merge for limit constraints
      const catalogValue = merged[key];
      if (typeof catalogValue === 'number') {
        merged[key] = Math.min(catalogValue, passportValue);
      } else {
        merged[key] = passportValue;
      }
    } else if (constraintType?.type === 'term') {
      // Gate-authoritative for term constraints (keep catalog value)
      // passport value is ignored
    } else {
      // Unknown constraint type - use passport value
      merged[key] = passportValue;
    }
  }
  
  return merged;
}

// =============================================================================
// CATALOG VERSION RESOLUTION
// =============================================================================

function resolveCatalogVersion(
  catalog: CachedCatalog,
  passport: Passport | null
): CatalogVersion | { deprecated: true } {
  // No passport → current version
  if (!passport?.catalog_version_pin) {
    return catalog.current;
  }
  
  const pin = passport.catalog_version_pin[catalog.gate_id];
  
  // No pin for this gate → current version
  if (pin === undefined) {
    return catalog.current;
  }
  
  // Check if pinned version is deprecated
  if (pin < catalog.min_compatible_version) {
    return { deprecated: true };
  }
  
  // Try to get pinned version, fall back to current
  return catalog.versions[pin] ?? catalog.current;
}

// =============================================================================
// VERIFY LOCALLY - THE HOT PATH (9-STEP ALGORITHM)
// =============================================================================

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
export function verifyLocally(params: VerifyLocallyParams): VerifyResult {
  const { passport, catalog, revocationList, issuerKeys, rateLimiter, action, context, skipSignatureVerification } = params;
  
  // Step 1: Check passport exists
  if (!passport) {
    return {
      allowed: false,
      denial: { code: 'NO_PASSPORT', message: 'No passport in session' },
      confident: true,
    };
  }
  
  // Step 2: Verify signature using ISSUER's public key
  // Passports are signed by issuers; gate verifies using cached issuer keys
  const issuerKey = issuerKeys[passport.issuer_id];
  if (!issuerKey) {
    // Unknown issuer defaults to deny
    return {
      allowed: false,
      denial: { 
        code: 'ISSUER_NOT_TRUSTED', 
        message: `Unknown issuer: ${passport.issuer_id}` 
      },
      confident: true,
    };
  }
  
  // Skip signature verification in test mode
  if (!skipSignatureVerification && !verifySignatureSync(passport, issuerKey)) {
    return {
      allowed: false,
      denial: { code: 'INVALID_SIGNATURE', message: 'Passport signature invalid' },
      confident: true,
    };
  }
  
  // Step 3: Check expiration (timezone-safe: expires_at is RFC3339)
  if (new Date(passport.expires_at) < new Date()) {
    return {
      allowed: false,
      denial: { code: 'PASSPORT_EXPIRED', message: 'Passport has expired' },
      confident: true,
    };
  }
  
  // Step 4: Check revocation (cached revocation list)
  if (revocationList.has(passport.passport_id)) {
    return {
      allowed: false,
      denial: { code: 'PASSPORT_REVOKED', message: 'Passport has been revoked' },
      confident: true,
    };
  }
  
  // Step 5: Resolve catalog version
  const effectiveCatalog = resolveCatalogVersion(catalog, passport);
  if ('deprecated' in effectiveCatalog) {
    return {
      allowed: false,
      denial: { 
        code: 'CATALOG_VERSION_DEPRECATED', 
        message: 'Passport pins to deprecated catalog version' 
      },
      confident: true,
    };
  }
  
  // Step 6: Check permission exists in CATALOG (Gate Authority Principle)
  const catalogEntry = effectiveCatalog.permissionsByKey[action];
  if (!catalogEntry) {
    return {
      allowed: false,
      denial: { 
        code: 'PERMISSION_NOT_IN_CATALOG', 
        message: `${action} not in gate catalog` 
      },
      confident: true,
    };
  }
  
  // Step 7: Check permission exists in PASSPORT
  // O(1) lookup using claimsByKey built at passport load time
  const passportPermission = passport.claimsByKey[action];
  if (!passportPermission) {
    return {
      allowed: false,
      denial: { 
        code: 'PERMISSION_NOT_IN_PASSPORT', 
        message: `Passport lacks ${action} permission`,
        upgrade_template: catalogEntry.default_template,
      },
      confident: true,
    };
  }
  
  // Step 8: Validate constraints
  const constraintResult = validateConstraints(
    passportPermission.constraints,
    context,
    catalogEntry.constraints
  );
  if (!constraintResult.valid) {
    return {
      allowed: false,
      denial: { 
        code: 'CONSTRAINT_EXCEEDED', 
        message: constraintResult.message ?? 'Constraint validation failed' 
      },
      confident: true,
    };
  }
  
  // Step 9: Check rate limits (local counters)
  if (!rateLimiter.check(action, passport.passport_id)) {
    return {
      allowed: false,
      denial: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' },
      confident: true,
    };
  }
  
  // All checks passed - increment rate limit counter and return success
  rateLimiter.increment(action, passport.passport_id);
  
  return {
    allowed: true,
    effective_constraints: mergeConstraints(
      catalogEntry.constraints,
      passportPermission.constraints
    ),
    confident: true,
  };
}

// =============================================================================
// PASSPORT UTILITIES
// =============================================================================

/**
 * Build claimsByKey index for O(1) permission lookup
 * MUST be called when loading a passport
 */
export function buildPassportIndex(passport: Omit<Passport, 'claimsByKey'>): Passport {
  const claimsByKey: Record<string, Passport['permissions'][0]> = {};
  
  for (const permission of passport.permissions) {
    claimsByKey[permission.permission_key] = permission;
  }
  
  return {
    ...passport,
    claimsByKey,
  };
}

/**
 * Check if a passport has a specific permission (without full verification)
 */
export function hasPermission(passport: Passport | null, action: string): boolean {
  if (!passport) return false;
  return action in passport.claimsByKey;
}

/**
 * Get constraints for a specific permission from passport
 */
export function getPermissionConstraints(
  passport: Passport | null,
  action: string
): Record<string, unknown> | undefined {
  if (!passport) return undefined;
  return passport.claimsByKey[action]?.constraints;
}
