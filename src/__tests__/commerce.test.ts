/**
 * Commerce Module Tests
 * Tests for consumption attestations, cost computation, and billing aggregation
 * 
 * Cross-ref: Patent #26 (Service Advertising), Patent #27 (Bilateral Metering)
 */

import { describe, it, expect } from 'vitest';
import {
  issueConsumptionAttestation,
  verifyConsumptionAttestation,
  generateRequestNonce,
  aggregateAttestations,
  matchesDiscoveryCriteria,
  meetsSLARequirements,
} from '../commerce.js';
import {
  computePlatformFee,
  computeCallCost,
  computeTimeCost,
  extractPricingConstraints,
  extractPlatformFeeConstraints,
  PricingConstraints,
  ConsumptionAttestation,
} from '../types.js';

// =============================================================================
// PLATFORM FEE COMPUTATION
// =============================================================================

describe('computePlatformFee', () => {
  it('computes 2% fee correctly', () => {
    // 2% = 200 basis points
    const fee = computePlatformFee(1000, 200);
    expect(fee).toBe(20); // 1000 * 200 / 10000 = 20 cents
  });

  it('uses ceiling rounding', () => {
    // 2% of 101 = 2.02, should round up to 3
    const fee = computePlatformFee(101, 200);
    expect(fee).toBe(3);
  });

  it('handles zero cost', () => {
    const fee = computePlatformFee(0, 200);
    expect(fee).toBe(0);
  });

  it('handles zero basis points', () => {
    const fee = computePlatformFee(1000, 0);
    expect(fee).toBe(0);
  });

  it('rejects negative cost', () => {
    expect(() => computePlatformFee(-100, 200)).toThrow('Cost cannot be negative');
  });

  it('rejects negative basis points', () => {
    expect(() => computePlatformFee(100, -200)).toThrow('Basis points cannot be negative');
  });
});

// =============================================================================
// COST COMPUTATION
// =============================================================================

describe('computeCallCost', () => {
  it('computes per-call cost', () => {
    const pricing: PricingConstraints = { per_call_cents: 10, currency: 'USD' };
    expect(computeCallCost(pricing, 1)).toBe(10);
    expect(computeCallCost(pricing, 5)).toBe(50);
  });

  it('returns 0 when no per_call_cents', () => {
    const pricing: PricingConstraints = { currency: 'USD' };
    expect(computeCallCost(pricing, 1)).toBe(0);
  });

  it('defaults to 1 unit', () => {
    const pricing: PricingConstraints = { per_call_cents: 10 };
    expect(computeCallCost(pricing)).toBe(10);
  });
});

describe('computeTimeCost', () => {
  it('computes per-minute cost', () => {
    const pricing: PricingConstraints = { per_minute_cents: 100 };
    expect(computeTimeCost(pricing, 60000)).toBe(100);  // 1 minute
    expect(computeTimeCost(pricing, 120000)).toBe(200); // 2 minutes
  });

  it('rounds up partial minutes', () => {
    const pricing: PricingConstraints = { per_minute_cents: 100 };
    expect(computeTimeCost(pricing, 61000)).toBe(200);  // 1.017 min -> 2 min
  });

  it('returns 0 when no per_minute_cents', () => {
    const pricing: PricingConstraints = { per_call_cents: 10 };
    expect(computeTimeCost(pricing, 60000)).toBe(0);
  });
});

// =============================================================================
// CONSTRAINT EXTRACTION
// =============================================================================

describe('extractPricingConstraints', () => {
  it('extracts all pricing fields', () => {
    const constraints = {
      'core:pricing:per_call_cents': 10,
      'core:pricing:currency': 'USD',
      'core:pricing:model': 'per_call',
      'core:pricing:free_tier_calls': 100,
    };
    
    const pricing = extractPricingConstraints(constraints);
    expect(pricing.per_call_cents).toBe(10);
    expect(pricing.currency).toBe('USD');
    expect(pricing.model).toBe('per_call');
    expect(pricing.free_tier_calls).toBe(100);
  });

  it('handles missing fields gracefully', () => {
    const pricing = extractPricingConstraints({});
    expect(pricing.per_call_cents).toBeUndefined();
    expect(pricing.currency).toBeUndefined();
  });
});

describe('extractPlatformFeeConstraints', () => {
  it('extracts platform fee fields', () => {
    const constraints = {
      'core:platform_fee:basis_points': 200,
      'core:platform_fee:recipient': 'gate_uniplex',
    };
    
    const fee = extractPlatformFeeConstraints(constraints);
    expect(fee.basis_points).toBe(200);
    expect(fee.recipient).toBe('gate_uniplex');
  });
});

// =============================================================================
// REQUEST NONCE
// =============================================================================

describe('generateRequestNonce', () => {
  it('generates unique nonces', () => {
    const nonce1 = generateRequestNonce('agent_test');
    const nonce2 = generateRequestNonce('agent_test');
    
    expect(nonce1.nonce).not.toBe(nonce2.nonce);
    expect(nonce1.agent_id).toBe('agent_test');
  });

  it('includes timestamp', () => {
    const nonce = generateRequestNonce('agent_test');
    expect(nonce.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// =============================================================================
// CONSUMPTION ATTESTATION
// =============================================================================

describe('issueConsumptionAttestation', () => {
  const mockSign = async (payload: string): Promise<string> => {
    return 'mock_sig_' + Buffer.from(payload).slice(0, 10).toString('hex');
  };

  it('creates attestation with correct structure', async () => {
    const attestation = await issueConsumptionAttestation({
      gate_id: 'gate_test',
      agent_id: 'agent_test',
      passport_id: 'passport_123',
      permission_key: 'weather:forecast',
      catalog_version: 1,
      effective_constraints: {
        'core:pricing:per_call_cents': 10,
        'core:pricing:currency': 'USD',
        'core:platform_fee:basis_points': 200,
      },
      sign: mockSign,
      signing_key_id: 'gate_test#key-1',
    });

    expect(attestation.attestation_type).toBe('consumption');
    expect(attestation.gate_id).toBe('gate_test');
    expect(attestation.agent_id).toBe('agent_test');
    expect(attestation.permission_key).toBe('weather:forecast');
    expect(attestation.consumption.cost_cents).toBe(10);
    expect(attestation.consumption.platform_fee_cents).toBe(1); // ceil(10 * 200 / 10000)
    expect(attestation.proof.type).toBe('JWS');
  });

  it('includes request nonce when provided', async () => {
    const attestation = await issueConsumptionAttestation({
      gate_id: 'gate_test',
      agent_id: 'agent_test',
      passport_id: 'passport_123',
      permission_key: 'weather:forecast',
      catalog_version: 1,
      effective_constraints: {},
      request_nonce: 'nonce_abc123',
      sign: mockSign,
      signing_key_id: 'gate_test#key-1',
    });

    expect(attestation.request_nonce).toBe('nonce_abc123');
  });

  it('computes time-based cost when duration provided', async () => {
    const attestation = await issueConsumptionAttestation({
      gate_id: 'gate_test',
      agent_id: 'agent_test',
      passport_id: 'passport_123',
      permission_key: 'llm:generate',
      catalog_version: 1,
      effective_constraints: {
        'core:pricing:per_minute_cents': 100,
        'core:pricing:model': 'per_minute',
      },
      duration_ms: 90000, // 1.5 minutes -> 2 minutes
      sign: mockSign,
      signing_key_id: 'gate_test#key-1',
    });

    expect(attestation.consumption.cost_cents).toBe(200);
    expect(attestation.consumption.duration_ms).toBe(90000);
  });
});

// =============================================================================
// ATTESTATION VERIFICATION
// =============================================================================

describe('verifyConsumptionAttestation', () => {
  const mockVerify = async (payload: string, sig: string, pubKey: string): Promise<boolean> => {
    // Mock verification - check sig starts with 'mock_sig_'
    return sig.startsWith('mock_sig_');
  };

  it('validates correct attestation', async () => {
    const attestation: ConsumptionAttestation = {
      attestation_type: 'consumption',
      attestation_id: 'catt_123',
      gate_id: 'gate_test',
      agent_id: 'agent_test',
      passport_id: 'passport_123',
      permission_key: 'weather:forecast',
      catalog_version: 1,
      effective_constraints: {
        pricing: { per_call_cents: 10 },
        platform_fee: { basis_points: 200 },
      },
      consumption: {
        units: 1,
        cost_cents: 10,
        platform_fee_cents: 1,
        timestamp: new Date().toISOString(),
      },
      proof: {
        type: 'JWS',
        kid: 'gate_test#key-1',
        sig: 'mock_sig_abc123',
      },
    };

    const result = await verifyConsumptionAttestation({
      attestation,
      gate_public_key: 'mock_pubkey',
      verify: mockVerify,
    });

    expect(result.valid).toBe(true);
  });

  it('rejects nonce mismatch', async () => {
    const attestation: ConsumptionAttestation = {
      attestation_type: 'consumption',
      attestation_id: 'catt_123',
      gate_id: 'gate_test',
      agent_id: 'agent_test',
      passport_id: 'passport_123',
      permission_key: 'weather:forecast',
      catalog_version: 1,
      request_nonce: 'nonce_wrong',
      effective_constraints: { pricing: {}, platform_fee: {} },
      consumption: {
        units: 1,
        cost_cents: 0,
        platform_fee_cents: 0,
        timestamp: new Date().toISOString(),
      },
      proof: { type: 'JWS', kid: 'test', sig: 'mock_sig_abc' },
    };

    const result = await verifyConsumptionAttestation({
      attestation,
      expected_nonce: 'nonce_expected',
      gate_public_key: 'mock_pubkey',
      verify: mockVerify,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('nonce mismatch');
  });

  it('rejects invalid signature', async () => {
    const attestation: ConsumptionAttestation = {
      attestation_type: 'consumption',
      attestation_id: 'catt_123',
      gate_id: 'gate_test',
      agent_id: 'agent_test',
      passport_id: 'passport_123',
      permission_key: 'test',
      catalog_version: 1,
      effective_constraints: { pricing: {}, platform_fee: {} },
      consumption: {
        units: 1,
        cost_cents: 0,
        platform_fee_cents: 0,
        timestamp: new Date().toISOString(),
      },
      proof: { type: 'JWS', kid: 'test', sig: 'invalid_signature' },
    };

    const result = await verifyConsumptionAttestation({
      attestation,
      gate_public_key: 'mock_pubkey',
      verify: mockVerify,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid signature');
  });
});

// =============================================================================
// BILLING AGGREGATION
// =============================================================================

describe('aggregateAttestations', () => {
  const createAttestation = (units: number, cost: number, fee: number): ConsumptionAttestation => ({
    attestation_type: 'consumption',
    attestation_id: `catt_${Math.random().toString(36).slice(2)}`,
    gate_id: 'gate_test',
    agent_id: 'agent_test',
    passport_id: 'passport_123',
    permission_key: 'weather:forecast',
    catalog_version: 1,
    effective_constraints: { pricing: {}, platform_fee: {} },
    consumption: {
      units,
      cost_cents: cost,
      platform_fee_cents: fee,
      timestamp: new Date().toISOString(),
    },
    proof: { type: 'JWS', kid: 'test', sig: 'mock_sig' },
  });

  it('aggregates multiple attestations', () => {
    const attestations = [
      createAttestation(1, 10, 1),
      createAttestation(2, 20, 1),
      createAttestation(1, 10, 1),
    ];

    const billing = aggregateAttestations(
      attestations,
      '2026-02-01T00:00:00Z',
      '2026-02-28T23:59:59Z'
    );

    expect(billing).not.toBeNull();
    expect(billing!.total_calls).toBe(4);
    expect(billing!.total_cost_cents).toBe(40);
    expect(billing!.total_platform_fee_cents).toBe(3);
    expect(billing!.attestation_ids.length).toBe(3);
  });

  it('returns null for empty array', () => {
    const billing = aggregateAttestations([], '2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z');
    expect(billing).toBeNull();
  });

  it('throws on mixed agent/gate pairs', () => {
    const att1 = createAttestation(1, 10, 1);
    const att2 = createAttestation(1, 10, 1);
    att2.agent_id = 'agent_other';

    expect(() => 
      aggregateAttestations([att1, att2], '2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z')
    ).toThrow('same agent/gate pair');
  });
});

// =============================================================================
// DISCOVERY HELPERS
// =============================================================================

describe('matchesDiscoveryCriteria', () => {
  it('matches when price is under ceiling', () => {
    const pricing: PricingConstraints = { per_call_cents: 10, currency: 'USD' };
    expect(matchesDiscoveryCriteria(pricing, 20, 'USD')).toBe(true);
  });

  it('rejects when price exceeds ceiling', () => {
    const pricing: PricingConstraints = { per_call_cents: 30, currency: 'USD' };
    expect(matchesDiscoveryCriteria(pricing, 20, 'USD')).toBe(false);
  });

  it('rejects currency mismatch', () => {
    const pricing: PricingConstraints = { per_call_cents: 10, currency: 'EUR' };
    expect(matchesDiscoveryCriteria(pricing, 20, 'USD')).toBe(false);
  });

  it('allows when no criteria specified', () => {
    const pricing: PricingConstraints = { per_call_cents: 100, currency: 'USD' };
    expect(matchesDiscoveryCriteria(pricing)).toBe(true);
  });
});

describe('meetsSLARequirements', () => {
  it('passes when SLA meets requirements', () => {
    const sla = { uptime_basis_points: 9999, response_time_ms: 100 };
    expect(meetsSLARequirements(sla, 9990, 200)).toBe(true);
  });

  it('rejects insufficient uptime', () => {
    const sla = { uptime_basis_points: 9900, response_time_ms: 100 };
    expect(meetsSLARequirements(sla, 9990, 200)).toBe(false);
  });

  it('rejects slow response time', () => {
    const sla = { uptime_basis_points: 9999, response_time_ms: 500 };
    expect(meetsSLARequirements(sla, undefined, 200)).toBe(false);
  });
});
