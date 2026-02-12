/**
 * Uniplex MCP Server - Verification Module
 * Version: 1.2.0
 *
 * CRITICAL: This module implements local verification.
 * verifyLocally() MUST NOT make network calls.
 *
 * Three-tier decision model (§14B.2):
 *   BLOCK   → wire "deny", no obligations
 *   SUSPEND → wire "deny" + reason_codes + obligations
 *   PERMIT  → wire "permit"
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
  DenyReason,
  type AnonymousAccessPolicy,
  type AnonymousRateLimiter,
} from './types.js';

import {
  evaluateConstraints,
  OBLIGATION_TOKENS,
  CONSTRAINT_KEYS,
  type ConstraintDecision,
  type CELResult,
  evaluateAnonymousAccess,
  MemoryAnonymousRateLimiter,
} from 'uniplex';

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
// CONSTRAINT VALIDATION (legacy — used as fallback)
// =============================================================================

interface ConstraintValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validate passport constraints against request context.
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
          message: `Constraint ${key} exceeded: ${contextNum} > ${passportValue}`,
        };
      }
    }

    // For term constraints, they are informational only (not enforced here)
  }

  return { valid: true };
}

/**
 * Merge catalog and passport constraints
 *
 * - limit constraints: min(catalog, passport) — most restrictive wins
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
    } else {
      // Unknown constraint type — use passport value
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
// HELPER: build a deny VerifyResult
// =============================================================================

function deny(
  code: DenyReason,
  message: string,
  extras?: {
    upgrade_template?: string;
    constraint_decision?: ConstraintDecision;
    reason_codes?: string[];
    obligations?: string[];
  },
): VerifyResult {
  return {
    allowed: false,
    decision: 'deny',
    constraint_decision: extras?.constraint_decision,
    reason_codes: extras?.reason_codes,
    obligations: extras?.obligations,
    denial: {
      code,
      message,
      upgrade_template: extras?.upgrade_template,
    },
    confident: true,
  };
}

// =============================================================================
// VERIFY LOCALLY — THE HOT PATH
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
  /** Anonymous access policy (§14A) */
  anonymousPolicy?: AnonymousAccessPolicy;
  /** Anonymous rate limiter */
  anonymousRateLimiter?: AnonymousRateLimiter;
  /** Source identifier for anonymous rate limiting */
  sourceId?: string;
}

/**
 * LOCAL verification — no network calls.
 * This is the hot path that runs on every tool call.
 *
 * Three-tier decision model (§14B.2):
 *   BLOCK   → deny, no obligations
 *   SUSPEND → deny with reason_codes=["approval_required"], obligations=["require_approval"]
 *   PERMIT  → allow
 *
 * Anti-downgrade (§14A.2): invalid/expired/revoked passports are ALWAYS denied.
 *   They MUST NOT fall back to anonymous access.
 *
 * NORMATIVE (RFC 2119):
 * - MUST NOT make network calls
 * - MUST complete in sub-millisecond time
 * - MUST use cached data only
 *
 * Implements the 9-step algorithm from Section 1.3 + CEL (§14B).
 */
export function verifyLocally(params: VerifyLocallyParams): VerifyResult {
  const {
    passport,
    catalog,
    revocationList,
    issuerKeys,
    rateLimiter,
    action,
    context,
    skipSignatureVerification,
    anonymousPolicy,
    anonymousRateLimiter,
    sourceId,
  } = params;

  // =======================================================================
  // Step 1: Check passport exists — if null, try anonymous policy
  // =======================================================================
  if (!passport) {
    // No passport presented — check anonymous access policy
    if (anonymousPolicy?.enabled) {
      const anonResult = evaluateAnonymousAccess({
        passport: null,
        passportValidationResult: null,
        action,
        policy: anonymousPolicy,
        rateLimiter: anonymousRateLimiter ?? new MemoryAnonymousRateLimiter({
          perMinute: anonymousPolicy.rate_limit_per_minute ?? 5,
          perHour: anonymousPolicy.rate_limit_per_hour ?? 50,
        }),
        sourceId: sourceId ?? 'unknown',
      });

      if (anonResult && anonResult.allowed) {
        return {
          allowed: true,
          decision: 'permit',
          confident: true,
        };
      }

      // Anonymous access denied — return upgrade info
      const upgradeMsg = anonymousPolicy.upgrade_message
        ?? 'Get a passport for full access and higher rate limits';
      return deny(DenyReason.PASSPORT_MISSING, upgradeMsg);
    }

    return deny(DenyReason.PASSPORT_MISSING, 'No passport in session');
  }

  // =======================================================================
  // Step 2: Verify signature using ISSUER's public key
  // Passports are signed by issuers; gate verifies using cached issuer keys
  // =======================================================================
  const issuerKey = issuerKeys[passport.issuer_id];
  if (!issuerKey) {
    // Anti-downgrade: unknown issuer with a passport → deny (NEVER fall to anon)
    return deny(DenyReason.ISSUER_NOT_ALLOWED, `Unknown issuer: ${passport.issuer_id}`, {
      constraint_decision: 'BLOCK',
    });
  }

  // Skip signature verification in test mode
  if (!skipSignatureVerification && !verifySignatureSync(passport, issuerKey)) {
    // Anti-downgrade: invalid signature → deny (NEVER fall to anon)
    return deny(DenyReason.INVALID_SIGNATURE, 'Passport signature invalid', {
      constraint_decision: 'BLOCK',
    });
  }

  // =======================================================================
  // Step 3: Check expiration (timezone-safe: expires_at is RFC3339)
  // Anti-downgrade: expired passport → deny (NEVER fall to anon)
  // =======================================================================
  if (new Date(passport.expires_at) < new Date()) {
    return deny(DenyReason.PASSPORT_EXPIRED, 'Passport has expired', {
      constraint_decision: 'BLOCK',
    });
  }

  // =======================================================================
  // Step 4: Check revocation (cached revocation list)
  // Anti-downgrade: revoked passport → deny (NEVER fall to anon)
  // =======================================================================
  if (revocationList.has(passport.passport_id)) {
    return deny(DenyReason.PASSPORT_REVOKED, 'Passport has been revoked', {
      constraint_decision: 'BLOCK',
    });
  }

  // =======================================================================
  // Step 5: Resolve catalog version
  // =======================================================================
  const effectiveCatalog = resolveCatalogVersion(catalog, passport);
  if ('deprecated' in effectiveCatalog) {
    return deny(
      DenyReason.CATALOG_VERSION_DEPRECATED,
      'Passport pins to deprecated catalog version',
      { constraint_decision: 'BLOCK' },
    );
  }

  // =======================================================================
  // Step 6: Check permission exists in CATALOG (Gate Authority Principle)
  // =======================================================================
  const catalogEntry = effectiveCatalog.permissionsByKey[action];
  if (!catalogEntry) {
    return deny(DenyReason.PERMISSION_DENIED, `${action} not in gate catalog`, {
      constraint_decision: 'BLOCK',
    });
  }

  // =======================================================================
  // Step 7: Check permission exists in PASSPORT
  // O(1) lookup using claimsByKey built at passport load time
  // =======================================================================
  const passportPermission = passport.claimsByKey[action];
  if (!passportPermission) {
    return deny(DenyReason.PERMISSION_DENIED, `Passport lacks ${action} permission`, {
      upgrade_template: catalogEntry.default_template,
      constraint_decision: 'BLOCK',
    });
  }

  // =======================================================================
  // Step 8: Constraint Enforcement Layer (CEL — §14B)
  //
  // Evaluate constraints in category order:
  //   Temporal → Scope → Rate → Cost → Approval → Data
  // with BLOCK > SUSPEND > PERMIT precedence.
  //
  // Commerce constraints (70+) are pass-through.
  // =======================================================================
  const effectiveConstraints = mergeConstraints(
    catalogEntry.constraints,
    passportPermission.constraints,
  );

  // Use protocol SDK's evaluateConstraints for full CEL evaluation
  const celResult: CELResult = evaluateConstraints({
    constraints: effectiveConstraints,
    action,
    costCents: typeof context['amount_canonical'] === 'number'
      ? context['amount_canonical']
      : undefined,
    metadata: context,
  });

  if (celResult.decision === 'BLOCK') {
    // Find the first BLOCK evaluation for the message
    const blockEval = celResult.evaluations.find(e => e.decision === 'BLOCK');
    return deny(
      DenyReason.CONSTRAINT_VIOLATED,
      blockEval?.reason ?? 'Constraint violation',
      { constraint_decision: 'BLOCK' },
    );
  }

  if (celResult.decision === 'SUSPEND') {
    return deny(
      DenyReason.APPROVAL_REQUIRED,
      'Action requires approval before proceeding',
      {
        constraint_decision: 'SUSPEND',
        reason_codes: celResult.reason_codes ?? ['approval_required'],
        obligations: celResult.obligations.length > 0
          ? celResult.obligations
          : [OBLIGATION_TOKENS.REQUIRE_APPROVAL],
      },
    );
  }

  // Also run legacy constraint validation for backward compat with custom keys
  const legacyResult = validateConstraints(
    passportPermission.constraints,
    context,
    catalogEntry.constraints,
  );
  if (!legacyResult.valid) {
    return deny(
      DenyReason.CONSTRAINT_VIOLATED,
      legacyResult.message ?? 'Constraint validation failed',
      { constraint_decision: 'BLOCK' },
    );
  }

  // =======================================================================
  // Step 9: Check rate limits (local counters)
  // =======================================================================
  if (!rateLimiter.check(action, passport.passport_id)) {
    return deny(DenyReason.RATE_LIMITED, 'Rate limit exceeded', {
      constraint_decision: 'BLOCK',
    });
  }

  // All checks passed — increment rate limit counter and return success
  rateLimiter.increment(action, passport.passport_id);

  return {
    allowed: true,
    decision: 'permit',
    constraint_decision: 'PERMIT',
    effective_constraints: effectiveConstraints,
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
