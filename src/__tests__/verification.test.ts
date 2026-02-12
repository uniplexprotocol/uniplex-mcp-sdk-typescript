/**
 * Uniplex MCP Server - Verification Tests
 *
 * Tests for verifyLocally 9-step algorithm with three-tier decision model.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyLocally,
  InMemoryRateLimiter,
  buildPassportIndex,
  validateConstraints,
  mergeConstraints,
} from '../verification.js';
import {
  Passport,
  CachedCatalog,
  CatalogPermission,
  DenyReason,
  OBLIGATION_TOKENS,
  CONSTRAINT_KEYS,
  type AnonymousAccessPolicy,
} from '../types.js';

// =========================================================================
// TEST FIXTURES
// =========================================================================

function createMockPassport(overrides: Partial<Passport> = {}): Passport {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const base: Omit<Passport, 'claimsByKey'> = {
    passport_id: 'passport_test_123',
    issuer_id: 'issuer_trusted',
    agent_id: 'agent_test',
    gate_id: 'gate_test',
    permissions: [
      { permission_key: 'flights:search', constraints: {} },
      { permission_key: 'flights:book', constraints: { 'core:cost:max_per_action': 100000 } },
    ],
    constraints: {},
    signature: '0'.repeat(128),
    expires_at: expiresAt.toISOString(),
    issued_at: now.toISOString(),
    ...overrides,
  };

  return buildPassportIndex(base);
}

function createMockCatalog(): CachedCatalog {
  const permissions: Record<string, CatalogPermission> = {
    'flights:search': {
      permission_key: 'flights:search',
      display_name: 'Search Flights',
      risk_level: 'low',
      constraints: {},
    },
    'flights:book': {
      permission_key: 'flights:book',
      display_name: 'Book Flights',
      risk_level: 'high',
      constraints: { 'core:cost:max_per_action': 500000 },
      required_constraints: ['core:cost:max_per_action'],
      default_template: 'travel-booker',
    },
    'admin:manage': {
      permission_key: 'admin:manage',
      display_name: 'Admin Management',
      risk_level: 'critical',
      constraints: {},
    },
    'data:read': {
      permission_key: 'data:read',
      display_name: 'Read Data',
      risk_level: 'low',
      constraints: {},
    },
  };

  return {
    gate_id: 'gate_test',
    current: {
      version: 1,
      permissionsByKey: permissions,
      published_at: new Date().toISOString(),
    },
    versions: {},
    min_compatible_version: 1,
    cached_at: Date.now(),
    permissionsByKey: permissions,
  };
}

// =========================================================================
// VERIFY LOCALLY TESTS (9-STEP ALGORITHM)
// =========================================================================

describe('verifyLocally', () => {
  let passport: Passport;
  let catalog: CachedCatalog;
  let revocationList: Set<string>;
  let issuerKeys: Record<string, string>;
  let rateLimiter: InMemoryRateLimiter;

  beforeEach(() => {
    passport = createMockPassport();
    catalog = createMockCatalog();
    revocationList = new Set();
    issuerKeys = { 'issuer_trusted': '0'.repeat(64) };
    rateLimiter = new InMemoryRateLimiter();
  });

  // Step 1: Check passport exists
  describe('Step 1: Passport exists', () => {
    it('denies with PASSPORT_MISSING when passport is null', () => {
      const result = verifyLocally({
        passport: null,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:search',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.PASSPORT_MISSING);
    });
  });

  // Step 2: Signature verification (using issuer key)
  describe('Step 2: Signature verification', () => {
    it('denies with ISSUER_NOT_ALLOWED for unknown issuer', () => {
      passport = createMockPassport({ issuer_id: 'issuer_unknown' });

      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:search',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.ISSUER_NOT_ALLOWED);
    });
  });

  // Step 3: Expiration check
  describe('Step 3: Expiration check', () => {
    it('denies with PASSPORT_EXPIRED for expired passport', () => {
      const expiredDate = new Date(Date.now() - 1000);
      passport = createMockPassport({ expires_at: expiredDate.toISOString() });

      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:search',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.PASSPORT_EXPIRED);
    });
  });

  // Step 4: Revocation check
  describe('Step 4: Revocation check', () => {
    it('denies with PASSPORT_REVOKED when passport is in revocation list', () => {
      revocationList.add('passport_test_123');

      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:search',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.PASSPORT_REVOKED);
    });
  });

  // Step 5: Catalog version resolution
  describe('Step 5: Catalog version resolution', () => {
    it('denies with CATALOG_VERSION_DEPRECATED for deprecated version', () => {
      passport = createMockPassport({
        catalog_version_pin: { 'gate_test': 0 },
      });
      catalog.min_compatible_version = 1;

      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:search',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.CATALOG_VERSION_DEPRECATED);
    });
  });

  // Step 6: Permission in catalog
  describe('Step 6: Permission in catalog', () => {
    it('denies with PERMISSION_DENIED for unknown permission', () => {
      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'unknown:permission',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.PERMISSION_DENIED);
    });
  });

  // Step 7: Permission in passport
  describe('Step 7: Permission in passport', () => {
    it('denies with PERMISSION_DENIED when passport lacks permission', () => {
      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'admin:manage',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.PERMISSION_DENIED);
    });

    it('includes upgrade_template from catalog when permission missing', () => {
      passport = createMockPassport({
        permissions: [{ permission_key: 'flights:search', constraints: {} }],
      });

      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:book',
        context: {},
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe(DenyReason.PERMISSION_DENIED);
      expect(result.denial?.upgrade_template).toBe('travel-booker');
    });
  });

  // Step 8: Constraint validation
  describe('Step 8: Constraint validation', () => {
    it('denies when context exceeds passport limit', () => {
      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:book',
        context: { 'core:cost:max_per_action': 150000 },
        skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
    });

    it('allows when context is within passport limit', () => {
      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:book',
        context: { 'core:cost:max_per_action': 50000 },
        skipSignatureVerification: true,
      });

      expect(result.decision).not.toBe('deny');
    });
  });

  // Step 9: Rate limit check
  describe('Step 9: Rate limit check', () => {
    it('denies with RATE_LIMITED when rate limit exceeded', () => {
      rateLimiter.setLimit('flights:search', 2, 60000);

      verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {}, skipSignatureVerification: true,
      });

      verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {}, skipSignatureVerification: true,
      });

      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {}, skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.denial?.code).toBe(DenyReason.RATE_LIMITED);
    });
  });

  // Three-tier decision model
  describe('Three-tier decision model', () => {
    it('returns decision "permit" with constraint_decision PERMIT on success', () => {
      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {}, skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(true);
      expect(result.decision).toBe('permit');
      expect(result.constraint_decision).toBe('PERMIT');
      expect(result.reason_codes).toBeUndefined();
      expect(result.obligations).toBeUndefined();
    });

    it('returns BLOCK constraint_decision on hard deny', () => {
      const expiredDate = new Date(Date.now() - 1000);
      passport = createMockPassport({ expires_at: expiredDate.toISOString() });

      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {}, skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.constraint_decision).toBe('BLOCK');
      expect(result.obligations).toBeUndefined();
    });

    it('SUSPEND maps to wire "deny" with reason_codes and obligations', () => {
      // Create passport with approval_required constraint
      passport = createMockPassport({
        permissions: [
          {
            permission_key: 'flights:search',
            constraints: { 'core:approval:required': true },
          },
        ],
      });

      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {}, skipSignatureVerification: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
      expect(result.constraint_decision).toBe('SUSPEND');
      expect(result.reason_codes).toContain('approval_required');
      expect(result.obligations).toContain(OBLIGATION_TOKENS.REQUIRE_APPROVAL);
      expect(result.denial?.code).toBe(DenyReason.APPROVAL_REQUIRED);
    });
  });

  // BLOCK > SUSPEND > PERMIT precedence
  describe('BLOCK > SUSPEND > PERMIT precedence', () => {
    it('BLOCK wins over SUSPEND', () => {
      // Expired passport (BLOCK) that also has approval_required (SUSPEND)
      const expiredDate = new Date(Date.now() - 1000);
      passport = createMockPassport({
        expires_at: expiredDate.toISOString(),
        permissions: [
          {
            permission_key: 'flights:search',
            constraints: { 'core:approval:required': true },
          },
        ],
      });

      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {}, skipSignatureVerification: true,
      });

      // Expiration (BLOCK) should prevent even reaching the CEL layer
      expect(result.constraint_decision).toBe('BLOCK');
      expect(result.obligations).toBeUndefined();
    });
  });

  // Anti-downgrade (§14A.2)
  describe('Anti-downgrade', () => {
    const anonPolicy: AnonymousAccessPolicy = {
      enabled: true,
      allowed_actions: ['flights:search', 'data:read'],
      read_only: true,
      rate_limit_per_minute: 5,
      rate_limit_per_hour: 50,
    };

    it('expired passport is denied even when anonymous is enabled', () => {
      const expiredDate = new Date(Date.now() - 1000);
      passport = createMockPassport({ expires_at: expiredDate.toISOString() });

      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {},
        skipSignatureVerification: true,
        anonymousPolicy: anonPolicy,
      });

      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe(DenyReason.PASSPORT_EXPIRED);
    });

    it('revoked passport is denied even when anonymous is enabled', () => {
      revocationList.add('passport_test_123');

      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {},
        skipSignatureVerification: true,
        anonymousPolicy: anonPolicy,
      });

      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe(DenyReason.PASSPORT_REVOKED);
    });

    it('unknown issuer is denied even when anonymous is enabled', () => {
      passport = createMockPassport({ issuer_id: 'issuer_unknown' });

      const result = verifyLocally({
        passport, catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {},
        skipSignatureVerification: true,
        anonymousPolicy: anonPolicy,
      });

      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe(DenyReason.ISSUER_NOT_ALLOWED);
    });
  });

  // Anonymous access policy (§14A)
  describe('Anonymous access policy', () => {
    const anonPolicy: AnonymousAccessPolicy = {
      enabled: true,
      allowed_actions: ['flights:search', 'data:read'],
      read_only: true,
      rate_limit_per_minute: 5,
      rate_limit_per_hour: 50,
      upgrade_message: 'Get a passport for full access',
    };

    it('allows anonymous access for listed actions when no passport', () => {
      const result = verifyLocally({
        passport: null,
        catalog, revocationList, issuerKeys, rateLimiter,
        action: 'data:read', context: {},
        skipSignatureVerification: true,
        anonymousPolicy: anonPolicy,
        sourceId: 'test-client',
      });

      expect(result.allowed).toBe(true);
      expect(result.decision).toBe('permit');
    });

    it('denies anonymous access for unlisted actions', () => {
      const result = verifyLocally({
        passport: null,
        catalog, revocationList, issuerKeys, rateLimiter,
        action: 'admin:manage', context: {},
        skipSignatureVerification: true,
        anonymousPolicy: anonPolicy,
        sourceId: 'test-client',
      });

      expect(result.allowed).toBe(false);
      expect(result.decision).toBe('deny');
    });

    it('returns PASSPORT_MISSING when anonymous is disabled', () => {
      const result = verifyLocally({
        passport: null,
        catalog, revocationList, issuerKeys, rateLimiter,
        action: 'flights:search', context: {},
        skipSignatureVerification: true,
        anonymousPolicy: { enabled: false, allowed_actions: [] },
      });

      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe(DenyReason.PASSPORT_MISSING);
    });
  });
});

// =========================================================================
// CONSTRAINT VALIDATION TESTS
// =========================================================================

describe('validateConstraints', () => {
  it('returns valid when context is within limits', () => {
    const result = validateConstraints(
      { 'core:cost:max_per_action': 100000 },
      { 'core:cost:max_per_action': 50000 }
    );

    expect(result.valid).toBe(true);
  });

  it('returns invalid when context exceeds limits', () => {
    const result = validateConstraints(
      { 'core:cost:max_per_action': 100000 },
      { 'core:cost:max_per_action': 150000 }
    );

    expect(result.valid).toBe(false);
    expect(result.message).toContain('exceeded');
  });

  it('ignores constraints not in context', () => {
    const result = validateConstraints(
      { 'core:cost:max_per_action': 100000 },
      { 'some:other:value': 'test' }
    );

    expect(result.valid).toBe(true);
  });
});

// =========================================================================
// CONSTRAINT MERGE TESTS
// =========================================================================

describe('mergeConstraints', () => {
  it('uses min value for limit constraints', () => {
    const result = mergeConstraints(
      { 'core:cost:max_per_action': 500000 },
      { 'core:cost:max_per_action': 100000 }
    );

    expect(result['core:cost:max_per_action']).toBe(100000);
  });

  it('preserves catalog value for term constraints', () => {
    const result = mergeConstraints(
      { 'core:pricing:per_call_cents': 50 },
      { 'core:pricing:per_call_cents': 100 } // Passport tries to change price
    );

    // Term constraints are gate-authoritative (catalog wins)
    expect(result['core:pricing:per_call_cents']).toBe(50);
  });

  it('merges multiple constraints correctly', () => {
    const result = mergeConstraints(
      { 'core:cost:max_per_action': 500000, 'core:rate:max_per_hour': 1000 },
      { 'core:cost:max_per_action': 100000, 'core:rate:max_per_hour': 500 }
    );

    expect(result['core:cost:max_per_action']).toBe(100000);
    expect(result['core:rate:max_per_hour']).toBe(500);
  });
});

// =========================================================================
// RATE LIMITER TESTS
// =========================================================================

describe('InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  it('allows requests when no limit set', () => {
    expect(limiter.check('action')).toBe(true);
  });

  it('tracks requests against limit', () => {
    limiter.setLimit('action', 2, 60000);

    expect(limiter.check('action')).toBe(true);
    limiter.increment('action');

    expect(limiter.check('action')).toBe(true);
    limiter.increment('action');

    expect(limiter.check('action')).toBe(false);
  });

  it('separates limits by passport ID', () => {
    limiter.setLimit('action', 1, 60000);

    limiter.increment('action', 'passport_1');
    expect(limiter.check('action', 'passport_1')).toBe(false);
    expect(limiter.check('action', 'passport_2')).toBe(true);
  });

  it('resets after window expires', async () => {
    limiter.setLimit('action', 1, 10); // 10ms window

    limiter.increment('action');
    expect(limiter.check('action')).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(limiter.check('action')).toBe(true);
  });
});

// =========================================================================
// PASSPORT INDEX TESTS
// =========================================================================

describe('buildPassportIndex', () => {
  it('creates claimsByKey for O(1) lookup', () => {
    const passport = createMockPassport();

    expect(passport.claimsByKey['flights:search']).toBeDefined();
    expect(passport.claimsByKey['flights:book']).toBeDefined();
    expect(passport.claimsByKey['unknown:permission']).toBeUndefined();
  });

  it('preserves permission constraints in index', () => {
    const passport = createMockPassport();

    expect(passport.claimsByKey['flights:book'].constraints).toEqual({
      'core:cost:max_per_action': 100000,
    });
  });
});

// =========================================================================
// PROTOCOL SDK CONSTANTS TESTS
// =========================================================================

describe('Protocol SDK constants', () => {
  it('OBLIGATION_TOKENS has all standard tokens', () => {
    expect(OBLIGATION_TOKENS.REQUIRE_APPROVAL).toBe('require_approval');
    expect(OBLIGATION_TOKENS.LOG_ACTION).toBe('log_action');
    expect(OBLIGATION_TOKENS.NOTIFY_OWNER).toBe('notify_owner');
  });

  it('CONSTRAINT_KEYS has all 16 core keys', () => {
    // Temporal
    expect(CONSTRAINT_KEYS.TIME_OPERATING_HOURS).toBe('core:time:operating_hours');
    expect(CONSTRAINT_KEYS.TIME_BLACKOUT_WINDOWS).toBe('core:time:blackout_windows');
    // Scope
    expect(CONSTRAINT_KEYS.DOMAIN_ALLOWLIST).toBe('core:scope:domain_allowlist');
    expect(CONSTRAINT_KEYS.DOMAIN_BLOCKLIST).toBe('core:scope:domain_blocklist');
    expect(CONSTRAINT_KEYS.ACTION_ALLOWLIST).toBe('core:scope:action_allowlist');
    expect(CONSTRAINT_KEYS.ACTION_BLOCKLIST).toBe('core:scope:action_blocklist');
    // Rate
    expect(CONSTRAINT_KEYS.MAX_PER_MINUTE).toBe('core:rate:max_per_minute');
    expect(CONSTRAINT_KEYS.MAX_PER_HOUR).toBe('core:rate:max_per_hour');
    expect(CONSTRAINT_KEYS.MAX_PER_DAY).toBe('core:rate:max_per_day');
    // Cost
    expect(CONSTRAINT_KEYS.MAX_PER_ACTION).toBe('core:cost:max_per_action');
    expect(CONSTRAINT_KEYS.MAX_CUMULATIVE).toBe('core:cost:max_cumulative');
    expect(CONSTRAINT_KEYS.APPROVAL_THRESHOLD).toBe('core:cost:approval_threshold');
    // Approval
    expect(CONSTRAINT_KEYS.APPROVAL_REQUIRED).toBe('core:approval:required');
    expect(CONSTRAINT_KEYS.APPROVAL_FOR_ACTIONS).toBe('core:approval:for_actions');
    // Data
    expect(CONSTRAINT_KEYS.DATA_READ_ONLY).toBe('core:data:read_only');
    expect(CONSTRAINT_KEYS.DATA_NO_PII_EXPORT).toBe('core:data:no_pii_export');
  });

  it('DenyReason has all 38 members', () => {
    // Spot check a few from each category
    expect(DenyReason.INVALID_SIGNATURE).toBeDefined();
    expect(DenyReason.PASSPORT_EXPIRED).toBeDefined();
    expect(DenyReason.PASSPORT_MISSING).toBeDefined();
    expect(DenyReason.ISSUER_NOT_ALLOWED).toBeDefined();
    expect(DenyReason.APPROVAL_REQUIRED).toBeDefined();
    expect(DenyReason.ANTI_DOWNGRADE).toBeDefined();
    expect(DenyReason.CATALOG_PIN_MISMATCH).toBeDefined();
    expect(DenyReason.SESSION_INVALID).toBeDefined();
    expect(DenyReason.PARENT_INVALID).toBeDefined();
    expect(DenyReason.CHAIN_TOO_DEEP).toBeDefined();
    expect(DenyReason.CONSTRAINT_VIOLATED).toBeDefined();
    expect(DenyReason.RATE_LIMITED).toBeDefined();
  });
});
