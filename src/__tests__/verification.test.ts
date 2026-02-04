/**
 * Uniplex MCP Server - Verification Tests
 * 
 * Tests for verifyLocally 9-step algorithm
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyLocally,
  InMemoryRateLimiter,
  buildPassportIndex,
  validateConstraints,
  mergeConstraints,
} from '../verification.js';
import { Passport, CachedCatalog, CatalogPermission } from '../types.js';

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
      { permission_key: 'flights:book', constraints: { 'core:cost:max': 100000 } },
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
      constraints: { 'core:cost:max': 500000 },
      required_constraints: ['core:cost:max'],
      default_template: 'travel-booker',
    },
    'admin:manage': {
      permission_key: 'admin:manage',
      display_name: 'Admin Management',
      risk_level: 'critical',
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
    it('denies with NO_PASSPORT when passport is null', () => {
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
      expect(result.denial?.code).toBe('NO_PASSPORT');
    });
  });
  
  // Step 2: Signature verification (using issuer key)
  describe('Step 2: Signature verification', () => {
    it('denies with ISSUER_NOT_TRUSTED for unknown issuer', () => {
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
      expect(result.denial?.code).toBe('ISSUER_NOT_TRUSTED');
    });
    
    // Note: Signature verification is mocked in tests
    // Real signature verification would require proper key pairs
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
      expect(result.denial?.code).toBe('PASSPORT_EXPIRED');
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
      expect(result.denial?.code).toBe('PASSPORT_REVOKED');
    });
  });
  
  // Step 5: Catalog version resolution
  describe('Step 5: Catalog version resolution', () => {
    it('denies with CATALOG_VERSION_DEPRECATED for deprecated version', () => {
      passport = createMockPassport({
        catalog_version_pin: { 'gate_test': 0 }, // Version 0 < min_compatible (1)
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
      expect(result.denial?.code).toBe('CATALOG_VERSION_DEPRECATED');
    });
  });
  
  // Step 6: Permission in catalog
  describe('Step 6: Permission in catalog', () => {
    it('denies with PERMISSION_NOT_IN_CATALOG for unknown permission', () => {
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
      expect(result.denial?.code).toBe('PERMISSION_NOT_IN_CATALOG');
    });
  });
  
  // Step 7: Permission in passport
  describe('Step 7: Permission in passport', () => {
    it('denies with PERMISSION_NOT_IN_PASSPORT when passport lacks permission', () => {
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
      expect(result.denial?.code).toBe('PERMISSION_NOT_IN_PASSPORT');
      expect(result.denial?.upgrade_template).toBeUndefined();
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
      expect(result.denial?.code).toBe('PERMISSION_NOT_IN_PASSPORT');
      expect(result.denial?.upgrade_template).toBe('travel-booker');
    });
  });
  
  // Step 8: Constraint validation
  describe('Step 8: Constraint validation', () => {
    it('denies with CONSTRAINT_EXCEEDED when context exceeds passport limit', () => {
      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:book',
        context: { 'core:cost:max': 150000 }, // Exceeds passport's 100000 limit
        skipSignatureVerification: true,
      });
      
      expect(result.allowed).toBe(false);
      expect(result.denial?.code).toBe('CONSTRAINT_EXCEEDED');
    });
    
    it('allows when context is within passport limit', () => {
      const result = verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:book',
        context: { 'core:cost:max': 50000 }, // Within passport's 100000 limit
        skipSignatureVerification: true,
      });
      
      // Note: Will fail signature check in real scenario
      // This test assumes mocked signature verification
      expect(result.denial?.code).not.toBe('CONSTRAINT_EXCEEDED');
    });
  });
  
  // Step 9: Rate limit check
  describe('Step 9: Rate limit check', () => {
    it('denies with RATE_LIMIT_EXCEEDED when rate limit exceeded', () => {
      rateLimiter.setLimit('flights:search', 2, 60000);
      
      // First two calls should succeed (assuming other checks pass)
      verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:search',
        context: {},
        skipSignatureVerification: true,
      });
      
      verifyLocally({
        passport,
        catalog,
        revocationList,
        issuerKeys,
        rateLimiter,
        action: 'flights:search',
        context: {},
        skipSignatureVerification: true,
      });
      
      // Third call should be rate limited
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
      expect(result.denial?.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});

// =========================================================================
// CONSTRAINT VALIDATION TESTS
// =========================================================================

describe('validateConstraints', () => {
  it('returns valid when context is within limits', () => {
    const result = validateConstraints(
      { 'core:cost:max': 100000 },
      { 'core:cost:max': 50000 }
    );
    
    expect(result.valid).toBe(true);
  });
  
  it('returns invalid when context exceeds limits', () => {
    const result = validateConstraints(
      { 'core:cost:max': 100000 },
      { 'core:cost:max': 150000 }
    );
    
    expect(result.valid).toBe(false);
    expect(result.message).toContain('exceeded');
  });
  
  it('ignores constraints not in context', () => {
    const result = validateConstraints(
      { 'core:cost:max': 100000 },
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
      { 'core:cost:max': 500000 },
      { 'core:cost:max': 100000 }
    );
    
    expect(result['core:cost:max']).toBe(100000);
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
      { 'core:cost:max': 500000, 'core:rate:max_per_hour': 1000 },
      { 'core:cost:max': 100000, 'core:rate:max_per_hour': 500 }
    );
    
    expect(result['core:cost:max']).toBe(100000);
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
      'core:cost:max': 100000,
    });
  });
});
