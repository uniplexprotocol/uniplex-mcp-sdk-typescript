"use strict";
/**
 * Uniplex MCP Server Type Definitions
 * Version: 1.0.0 (2026-02-03)
 *
 * Implements types from Uniplex MCP Server Specification v1.0.0
 * Cross-references: Permission Catalog Spec v1.2.4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSTRAINT_TYPES = void 0;
exports.computePlatformFee = computePlatformFee;
exports.computeCallCost = computeCallCost;
exports.computeTimeCost = computeTimeCost;
exports.extractPricingConstraints = extractPricingConstraints;
exports.extractSLAConstraints = extractSLAConstraints;
exports.extractPlatformFeeConstraints = extractPlatformFeeConstraints;
/**
 * Constraint type registry - defines limit vs term constraints
 *
 * - limit: access control constraints (min-merge, passport can restrict)
 * - term: commercial terms (gate-authoritative, credentials bind TO)
 */
exports.CONSTRAINT_TYPES = {
    // Access control constraints (limit type)
    'core:rate:max_per_hour': { type: 'limit', valueType: 'integer' },
    'core:rate:max_per_day': { type: 'limit', valueType: 'integer' },
    'core:rate:max_per_minute': { type: 'limit', valueType: 'integer' },
    'core:cost:max': { type: 'limit', valueType: 'integer' },
    'core:cost:currency': { type: 'limit', valueType: 'string' },
    // Commerce constraints (term type) — forward compatibility with Uni-Commerce
    'core:pricing:per_call_cents': { type: 'term', valueType: 'integer' },
    'core:pricing:per_minute_cents': { type: 'term', valueType: 'integer' },
    'core:pricing:model': { type: 'term', valueType: 'string' },
    'core:pricing:currency': { type: 'term', valueType: 'string' },
    'core:pricing:free_tier_calls': { type: 'term', valueType: 'integer' },
    'core:sla:uptime_basis_points': { type: 'term', valueType: 'integer' },
    'core:sla:response_time_ms': { type: 'term', valueType: 'integer' },
    'core:sla:p99_response_ms': { type: 'term', valueType: 'integer' },
    'core:platform_fee:basis_points': { type: 'term', valueType: 'integer' },
};
// =============================================================================
// COMMERCE FUNCTIONS
// =============================================================================
/**
 * Platform fee computation (Normative)
 * fee_cents = ceil(service_cost_cents * basis_points / 10000)
 * Cross-ref: Patent #27, Section 4.1
 */
function computePlatformFee(serviceCostCents, basisPoints) {
    if (serviceCostCents < 0)
        throw new Error('Cost cannot be negative');
    if (basisPoints < 0)
        throw new Error('Basis points cannot be negative');
    return Math.ceil(serviceCostCents * basisPoints / 10000);
}
/**
 * Compute cost for a single call based on pricing constraints
 */
function computeCallCost(pricing, units = 1) {
    if (pricing.per_call_cents !== undefined) {
        return pricing.per_call_cents * units;
    }
    return 0;
}
/**
 * Compute cost for time-based pricing
 */
function computeTimeCost(pricing, durationMs) {
    if (pricing.per_minute_cents !== undefined) {
        const minutes = Math.ceil(durationMs / 60000);
        return pricing.per_minute_cents * minutes;
    }
    return 0;
}
/**
 * Extract pricing constraints from a constraint record
 */
function extractPricingConstraints(constraints) {
    return {
        per_call_cents: constraints['core:pricing:per_call_cents'],
        per_minute_cents: constraints['core:pricing:per_minute_cents'],
        subscription_cents: constraints['core:pricing:subscription_cents'],
        model: constraints['core:pricing:model'],
        currency: constraints['core:pricing:currency'],
        free_tier_calls: constraints['core:pricing:free_tier_calls'],
    };
}
/**
 * Extract SLA constraints from a constraint record
 */
function extractSLAConstraints(constraints) {
    return {
        uptime_basis_points: constraints['core:sla:uptime_basis_points'],
        response_time_ms: constraints['core:sla:response_time_ms'],
        p99_response_ms: constraints['core:sla:p99_response_ms'],
        guaranteed_response_ms: constraints['core:sla:guaranteed_response_ms'],
    };
}
/**
 * Extract platform fee constraints from a constraint record
 */
function extractPlatformFeeConstraints(constraints) {
    return {
        basis_points: constraints['core:platform_fee:basis_points'],
        recipient: constraints['core:platform_fee:recipient'],
    };
}
//# sourceMappingURL=types.js.map