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
import { ConsumptionAttestation, PricingConstraints, RequestNonce, BillingPeriod } from './types.js';
export interface IssueReceiptParams {
    gate_id: string;
    agent_id: string;
    passport_id: string;
    permission_key: string;
    catalog_version: number;
    catalog_content_hash?: string;
    effective_constraints: Record<string, unknown>;
    request_nonce?: string;
    units?: number;
    duration_ms?: number;
    sign: (payload: string) => Promise<string>;
    signing_key_id: string;
}
/**
 * Issue a consumption attestation (receipt) after successful tool execution
 *
 * The gate issues this to create a bilateral record of the transaction.
 * Both gate and agent retain identical signed attestations.
 *
 * Cross-ref: Patent #27, Section 2.2
 */
export declare function issueConsumptionAttestation(params: IssueReceiptParams): Promise<ConsumptionAttestation>;
export interface VerifyReceiptParams {
    attestation: ConsumptionAttestation;
    expected_nonce?: string;
    gate_public_key: string;
    verify: (payload: string, signature: string, publicKey: string) => Promise<boolean>;
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
export declare function verifyConsumptionAttestation(params: VerifyReceiptParams): Promise<{
    valid: boolean;
    error?: string;
}>;
/**
 * Generate a request nonce for bilateral verification
 *
 * Agent generates this before making a tool call and expects
 * it to be echoed in the consumption attestation.
 *
 * Cross-ref: Patent #27, Section 2.1
 */
export declare function generateRequestNonce(agent_id: string): RequestNonce;
/**
 * Aggregate consumption attestations into a billing period
 *
 * Cross-ref: Patent #27, Section 3.2
 */
export declare function aggregateAttestations(attestations: ConsumptionAttestation[], period_start: string, period_end: string): BillingPeriod | null;
/**
 * Check if a service matches discovery criteria
 */
export declare function matchesDiscoveryCriteria(pricing: PricingConstraints, maxPriceCents?: number, currency?: string): boolean;
/**
 * Check if service meets SLA requirements
 */
export declare function meetsSLARequirements(sla: {
    uptime_basis_points?: number;
    response_time_ms?: number;
}, minUptimeBasisPoints?: number, maxResponseTimeMs?: number): boolean;
export { computePlatformFee, computeCallCost, computeTimeCost, extractPricingConstraints, extractPlatformFeeConstraints, } from './types.js';
//# sourceMappingURL=commerce.d.ts.map