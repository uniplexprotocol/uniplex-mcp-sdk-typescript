"use strict";
/**
 * Uniplex MCP Server - Commerce Module
 * Version: 1.0.0
 *
 * Implements commerce primitives for agent-to-agent transactions:
 * - Consumption attestations (receipts)
 * - Cost computation
 * - Bilateral verification
 *
 * Cross-ref: Patent #26 (Service Advertising), Patent #27 (Bilateral Metering)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPlatformFeeConstraints = exports.extractPricingConstraints = exports.computeTimeCost = exports.computeCallCost = exports.computePlatformFee = void 0;
exports.issueConsumptionAttestation = issueConsumptionAttestation;
exports.verifyConsumptionAttestation = verifyConsumptionAttestation;
exports.generateRequestNonce = generateRequestNonce;
exports.aggregateAttestations = aggregateAttestations;
exports.matchesDiscoveryCriteria = matchesDiscoveryCriteria;
exports.meetsSLARequirements = meetsSLARequirements;
const types_js_1 = require("./types.js");
/**
 * Issue a consumption attestation (receipt) after successful tool execution
 *
 * The gate issues this to create a bilateral record of the transaction.
 * Both gate and agent retain identical signed attestations.
 *
 * Cross-ref: Patent #27, Section 2.2
 */
async function issueConsumptionAttestation(params) {
    const { gate_id, agent_id, passport_id, permission_key, catalog_version, catalog_content_hash, effective_constraints, request_nonce, units = 1, duration_ms, sign, signing_key_id, } = params;
    // Extract pricing from constraints
    const pricing = (0, types_js_1.extractPricingConstraints)(effective_constraints);
    const platformFee = (0, types_js_1.extractPlatformFeeConstraints)(effective_constraints);
    // Compute costs
    let cost_cents = 0;
    if (pricing.model === 'per_minute' && duration_ms !== undefined) {
        cost_cents = (0, types_js_1.computeTimeCost)(pricing, duration_ms);
    }
    else {
        cost_cents = (0, types_js_1.computeCallCost)(pricing, units);
    }
    // Compute platform fee
    const platform_fee_cents = platformFee.basis_points
        ? (0, types_js_1.computePlatformFee)(cost_cents, platformFee.basis_points)
        : 0;
    // Build consumption data
    const consumption = {
        units,
        cost_cents,
        platform_fee_cents,
        timestamp: new Date().toISOString(),
        ...(duration_ms !== undefined && { duration_ms }),
    };
    // Build attestation (without signature)
    const attestation_id = `catt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const attestationPayload = {
        attestation_type: 'consumption',
        attestation_id,
        gate_id,
        agent_id,
        passport_id,
        permission_key,
        catalog_version,
        ...(catalog_content_hash && { catalog_content_hash }),
        ...(request_nonce && { request_nonce }),
        effective_constraints: {
            pricing,
            platform_fee: platformFee,
        },
        consumption,
    };
    // Canonical JSON for signing
    const canonicalJson = JSON.stringify(attestationPayload);
    // Sign the attestation
    const signature = await sign(canonicalJson);
    return {
        ...attestationPayload,
        proof: {
            type: 'JWS',
            kid: signing_key_id,
            sig: signature,
        },
    };
}
/**
 * Verify a consumption attestation received from a gate
 *
 * Agent-side verification ensures:
 * 1. Signature is valid (gate actually issued this)
 * 2. Request nonce matches (prevents fabrication)
 * 3. Costs are computed correctly from constraints
 *
 * Cross-ref: Patent #27, Section 2.3
 */
async function verifyConsumptionAttestation(params) {
    const { attestation, expected_nonce, gate_public_key, verify } = params;
    // Check nonce if provided
    if (expected_nonce && attestation.request_nonce !== expected_nonce) {
        return {
            valid: false,
            error: 'Request nonce mismatch - attestation may be fabricated'
        };
    }
    // Reconstruct canonical JSON (without proof)
    const { proof, ...payloadWithoutProof } = attestation;
    const canonicalJson = JSON.stringify(payloadWithoutProof);
    // Verify signature
    const signatureValid = await verify(canonicalJson, proof.sig, gate_public_key);
    if (!signatureValid) {
        return { valid: false, error: 'Invalid signature' };
    }
    // Verify cost computation
    const pricing = attestation.effective_constraints.pricing ?? {};
    const platformFee = attestation.effective_constraints.platform_fee ?? {};
    let expectedCost = 0;
    if (pricing.model === 'per_minute' && attestation.consumption.duration_ms) {
        expectedCost = (0, types_js_1.computeTimeCost)(pricing, attestation.consumption.duration_ms);
    }
    else {
        expectedCost = (0, types_js_1.computeCallCost)(pricing, attestation.consumption.units);
    }
    if (attestation.consumption.cost_cents !== expectedCost) {
        return {
            valid: false,
            error: `Cost mismatch: expected ${expectedCost}, got ${attestation.consumption.cost_cents}`
        };
    }
    // Verify platform fee computation
    const expectedFee = platformFee.basis_points
        ? (0, types_js_1.computePlatformFee)(expectedCost, platformFee.basis_points)
        : 0;
    if (attestation.consumption.platform_fee_cents !== expectedFee) {
        return {
            valid: false,
            error: `Platform fee mismatch: expected ${expectedFee}, got ${attestation.consumption.platform_fee_cents}`
        };
    }
    return { valid: true };
}
// =============================================================================
// REQUEST NONCE GENERATION
// =============================================================================
/**
 * Generate a request nonce for bilateral verification
 *
 * Agent generates this before making a tool call and expects
 * it to be echoed in the consumption attestation.
 *
 * Cross-ref: Patent #27, Section 2.1
 */
function generateRequestNonce(agent_id) {
    const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    return {
        nonce,
        timestamp: new Date().toISOString(),
        agent_id,
    };
}
// =============================================================================
// BILLING AGGREGATION
// =============================================================================
/**
 * Aggregate consumption attestations into a billing period
 *
 * Cross-ref: Patent #27, Section 3.2
 */
function aggregateAttestations(attestations, period_start, period_end) {
    if (attestations.length === 0)
        return null;
    // All attestations must be for same agent/gate pair
    const first = attestations[0];
    const agent_id = first.agent_id;
    const gate_id = first.gate_id;
    // Validate all attestations match
    for (const att of attestations) {
        if (att.agent_id !== agent_id || att.gate_id !== gate_id) {
            throw new Error('All attestations must be for the same agent/gate pair');
        }
    }
    // Aggregate totals
    let total_calls = 0;
    let total_cost_cents = 0;
    let total_platform_fee_cents = 0;
    const attestation_ids = [];
    for (const att of attestations) {
        total_calls += att.consumption.units;
        total_cost_cents += att.consumption.cost_cents;
        total_platform_fee_cents += att.consumption.platform_fee_cents;
        attestation_ids.push(att.attestation_id);
    }
    return {
        period_start,
        period_end,
        agent_id,
        gate_id,
        total_calls,
        total_cost_cents,
        total_platform_fee_cents,
        attestation_ids,
    };
}
// =============================================================================
// SERVICE ADVERTISEMENT HELPERS
// =============================================================================
/**
 * Check if a service matches discovery criteria
 */
function matchesDiscoveryCriteria(pricing, maxPriceCents, currency) {
    // Check currency match
    if (currency && pricing.currency && pricing.currency !== currency) {
        return false;
    }
    // Check price ceiling
    if (maxPriceCents !== undefined) {
        const cost = pricing.per_call_cents ?? pricing.per_minute_cents ?? 0;
        if (cost > maxPriceCents) {
            return false;
        }
    }
    return true;
}
/**
 * Check if service meets SLA requirements
 */
function meetsSLARequirements(sla, minUptimeBasisPoints, maxResponseTimeMs) {
    if (minUptimeBasisPoints !== undefined) {
        if (!sla.uptime_basis_points || sla.uptime_basis_points < minUptimeBasisPoints) {
            return false;
        }
    }
    if (maxResponseTimeMs !== undefined) {
        if (!sla.response_time_ms || sla.response_time_ms > maxResponseTimeMs) {
            return false;
        }
    }
    return true;
}
// =============================================================================
// EXPORTS
// =============================================================================
var types_js_2 = require("./types.js");
Object.defineProperty(exports, "computePlatformFee", { enumerable: true, get: function () { return types_js_2.computePlatformFee; } });
Object.defineProperty(exports, "computeCallCost", { enumerable: true, get: function () { return types_js_2.computeCallCost; } });
Object.defineProperty(exports, "computeTimeCost", { enumerable: true, get: function () { return types_js_2.computeTimeCost; } });
Object.defineProperty(exports, "extractPricingConstraints", { enumerable: true, get: function () { return types_js_2.extractPricingConstraints; } });
Object.defineProperty(exports, "extractPlatformFeeConstraints", { enumerable: true, get: function () { return types_js_2.extractPlatformFeeConstraints; } });
//# sourceMappingURL=commerce.js.map