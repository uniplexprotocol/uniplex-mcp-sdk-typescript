/**
 * Uniplex MCP Server Type Definitions
 * Version: 1.0.0 (2026-02-03)
 *
 * Implements types from Uniplex MCP Server Specification v1.0.0
 * Cross-references: Permission Catalog Spec v1.2.4
 */
export type DenialCode = 'NO_PASSPORT' | 'ISSUER_NOT_TRUSTED' | 'INVALID_SIGNATURE' | 'PASSPORT_EXPIRED' | 'PASSPORT_REVOKED' | 'PERMISSION_NOT_IN_CATALOG' | 'PERMISSION_NOT_IN_PASSPORT' | 'CONSTRAINT_EXCEEDED' | 'RATE_LIMIT_EXCEEDED' | 'APPROVAL_REQUIRED' | 'CATALOG_VERSION_DEPRECATED' | 'CATALOG_VERSION_UNKNOWN' | 'CATALOG_VERSION_STALE';
export type UniplexMCPError = 'UNIPLEX_UNAVAILABLE' | 'GATE_NOT_FOUND' | 'PASSPORT_INVALID' | 'PASSPORT_EXPIRED' | 'PERMISSION_DENIED' | 'CONSTRAINT_EXCEEDED' | 'APPROVAL_REQUIRED' | 'RATE_LIMIT_EXCEEDED' | 'CATALOG_VERSION_DEPRECATED' | 'CATALOG_VERSION_UNKNOWN' | 'CATALOG_VERSION_STALE';
export type TransformMode = 'strict' | 'round' | 'truncate';
export type ConstraintType = 'limit' | 'term';
export interface ConstraintTypeDefinition {
    type: ConstraintType;
    valueType: 'integer' | 'string';
}
/**
 * Constraint type registry - defines limit vs term constraints
 *
 * - limit: access control constraints (min-merge, passport can restrict)
 * - term: commercial terms (gate-authoritative, credentials bind TO)
 */
export declare const CONSTRAINT_TYPES: Record<string, ConstraintTypeDefinition>;
export interface PassportPermission {
    permission_key: string;
    constraints: Record<string, unknown>;
}
export interface Passport {
    passport_id: string;
    issuer_id: string;
    agent_id: string;
    gate_id: string;
    permissions: PassportPermission[];
    constraints: Record<string, unknown>;
    signature: string;
    expires_at: string;
    issued_at: string;
    catalog_version_pin?: Record<string, number>;
    claimsByKey: Record<string, PassportPermission>;
}
export interface CatalogPermission {
    permission_key: string;
    display_name: string;
    description?: string;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    constraints: Record<string, unknown>;
    default_template?: string;
    required_constraints?: string[];
}
export interface CatalogVersion {
    version: number;
    permissionsByKey: Record<string, CatalogPermission>;
    published_at: string;
}
export interface CachedCatalog {
    gate_id: string;
    current: CatalogVersion;
    versions: Record<number, CatalogVersion>;
    min_compatible_version: number;
    cached_at: number;
    permissionsByKey: Record<string, CatalogPermission>;
}
export interface VerifyDenial {
    code: DenialCode;
    message: string;
    upgrade_template?: string;
}
export interface VerifyResult {
    allowed: boolean;
    denial?: VerifyDenial;
    effective_constraints?: Record<string, unknown>;
    confident: boolean;
}
export interface VerifyRequest {
    passport: Passport | null;
    catalog: CachedCatalog;
    issuerKeys: Record<string, string>;
    revocationList: Set<string>;
    action: string;
    context: RequestContext;
}
export type RequestContext = Record<string, unknown>;
export interface RateLimiter {
    check(action: string, passportId?: string): boolean;
    increment(action: string, passportId?: string): void;
    reset(action: string, passportId?: string): void;
}
export interface ConstraintMapping {
    key: string;
    source: 'input' | 'fixed';
    input_path?: string;
    fixed_value?: unknown;
    transform?: 'none' | 'dollars_to_cents' | 'custom';
    precision?: number;
    transform_mode?: TransformMode;
}
export interface ToolDefinition {
    name: string;
    description?: string;
    inputSchema: JSONSchema;
    permission_key: string;
    risk_level?: 'low' | 'medium' | 'high' | 'critical';
    required_constraints?: string[];
    constraints?: ConstraintMapping[];
    handler: (input: unknown) => Promise<unknown>;
}
export type ToolMapping = ToolDefinition;
export interface JSONSchema {
    type?: string;
    properties?: Record<string, JSONSchema>;
    required?: string[];
    items?: JSONSchema;
    [key: string]: unknown;
}
export interface Session {
    session_id: string;
    passport: Passport | null;
    created_at: number;
    last_activity: number;
}
export interface SessionState {
    allowed: boolean;
    reason?: string;
    upgrade_template?: string;
    effective_constraints?: Record<string, unknown>;
}
export interface SafeDefaultConfig {
    enabled: boolean;
    auto_issue: boolean;
    permissions: string[];
    constraints: Record<string, unknown>;
    max_lifetime: string;
}
export interface SwarmConfig {
    enabled: boolean;
    expose_pool_creation: boolean;
    expose_grant_claiming: boolean;
}
export interface CacheConfig {
    catalog_max_age_minutes: number;
    revocation_max_age_minutes: number;
    fail_mode: 'fail_open' | 'fail_closed';
    fail_mode_overrides?: Record<string, {
        fail_mode: 'fail_open' | 'fail_closed';
        revocation_max_age_minutes: number;
    }>;
}
export interface AuditConfig {
    enabled: boolean;
    log_inputs: boolean;
    log_outputs: boolean;
    webhook_url?: string;
    mode?: AttestationMode;
}
export type AttestationMode = 'full' | 'sampled' | 'session_digest';
export interface SampledConfig {
    sample_rate: number;
    always_log_denials: boolean;
}
export interface SessionDigestConfig {
    commit_interval_seconds: number;
    include_tool_hashes: boolean;
}
export interface CommerceConfig {
    enabled: boolean;
    issue_receipts: boolean;
    signing_key_id?: string;
}
export interface UniplexMCPServerConfig {
    uniplex_api_url: string;
    gate_id: string;
    gate_secret?: string;
    signing_key_id?: string;
    safe_default: SafeDefaultConfig;
    swarm?: SwarmConfig;
    trusted_issuers: string[];
    trust_networks?: string[];
    tools: ToolMapping[];
    cache?: CacheConfig;
    audit?: AuditConfig;
    commerce?: CommerceConfig;
    test_mode?: {
        enabled: boolean;
        mock_passport?: {
            permissions: string[];
            constraints: Record<string, unknown>;
        };
    };
}
export interface UniplexCapabilities {
    version: string;
    gate_id: string;
    catalog_discovery: boolean;
    safe_default: boolean;
    request_templates: boolean;
    session?: {
        passport_id?: string;
        permissions: string[];
        constraints: Record<string, unknown>;
        expires_at?: string;
    };
}
export interface ServerCapabilities {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
    uniplex?: UniplexCapabilities;
}
export interface UniplexToolMeta {
    permission_key: string;
    risk_level?: string;
    required_constraints?: string[];
    constraints?: Array<{
        key: string;
        source: string;
        input_path?: string;
        transform?: string;
        precision?: number;
    }>;
    session_state: SessionState;
}
export interface UniplexDenialMeta {
    denial_code: DenialCode;
    message: string;
    upgrade_template?: string;
    suggestions?: string[];
}
export interface Attestation {
    attestation_id: string;
    gate_id: string;
    passport_id: string;
    action: string;
    result: 'allowed' | 'denied';
    denial_code?: DenialCode;
    context: Record<string, unknown>;
    timestamp: string;
    attestation_json: string;
    signature: string;
}
/**
 * Pricing model for a permission
 */
export type PricingModel = 'per_call' | 'per_minute' | 'subscription' | 'usage';
/**
 * Pricing constraints extracted from catalog
 */
export interface PricingConstraints {
    per_call_cents?: number;
    per_minute_cents?: number;
    subscription_cents?: number;
    model?: PricingModel;
    currency?: string;
    free_tier_calls?: number;
}
/**
 * SLA constraints extracted from catalog
 */
export interface SLAConstraints {
    uptime_basis_points?: number;
    response_time_ms?: number;
    p99_response_ms?: number;
    guaranteed_response_ms?: number;
}
/**
 * Platform fee configuration
 */
export interface PlatformFeeConstraints {
    basis_points?: number;
    recipient?: string;
}
/**
 * Service advertisement - extends catalog permission with commerce metadata
 * Cross-ref: Patent #26, Section 2.3
 */
export interface ServiceAdvertisement {
    permission_key: string;
    display_name: string;
    description?: string;
    trust_level_required?: number;
    pricing: PricingConstraints;
    sla?: SLAConstraints;
    platform_fee?: PlatformFeeConstraints;
}
/**
 * Consumption data for a single transaction
 * Cross-ref: Patent #27, Section 2.4
 */
export interface ConsumptionData {
    units: number;
    cost_cents: number;
    platform_fee_cents: number;
    timestamp: string;
    duration_ms?: number;
}
/**
 * Request nonce from agent for bilateral verification
 * Cross-ref: Patent #27, Section 2.1
 */
export interface RequestNonce {
    nonce: string;
    timestamp: string;
    agent_id: string;
}
/**
 * Consumption attestation - receipt issued by gate after tool execution
 * Cross-ref: Patent #27, Commerce Integration Plan Section 2.4
 */
export interface ConsumptionAttestation {
    attestation_type: 'consumption';
    attestation_id: string;
    gate_id: string;
    agent_id: string;
    passport_id: string;
    permission_key: string;
    catalog_version: number;
    catalog_content_hash?: string;
    request_nonce?: string;
    effective_constraints: {
        pricing?: PricingConstraints;
        platform_fee?: PlatformFeeConstraints;
    };
    consumption: ConsumptionData;
    proof: {
        type: 'JWS';
        kid: string;
        sig: string;
    };
}
/**
 * Discovery query for finding services
 * Cross-ref: Patent #26, Section 2.5
 */
export interface DiscoveryQuery {
    capability?: string;
    max_price_cents?: number;
    min_uptime_basis_points?: number;
    min_trust_level?: number;
    currency?: string;
    limit?: number;
    offset?: number;
}
/**
 * Discovery result - gate matching query criteria
 */
export interface DiscoveryResult {
    gate_id: string;
    gate_name?: string;
    trust_level: number;
    services: ServiceAdvertisement[];
    catalog_version: number;
    catalog_content_hash?: string;
}
/**
 * Billing aggregation for settlement
 * Cross-ref: Patent #27, Section 3.2
 */
export interface BillingPeriod {
    period_start: string;
    period_end: string;
    agent_id: string;
    gate_id: string;
    total_calls: number;
    total_cost_cents: number;
    total_platform_fee_cents: number;
    attestation_ids: string[];
    merkle_root?: string;
}
/**
 * Platform fee computation (Normative)
 * fee_cents = ceil(service_cost_cents * basis_points / 10000)
 * Cross-ref: Patent #27, Section 4.1
 */
export declare function computePlatformFee(serviceCostCents: number, basisPoints: number): number;
/**
 * Compute cost for a single call based on pricing constraints
 */
export declare function computeCallCost(pricing: PricingConstraints, units?: number): number;
/**
 * Compute cost for time-based pricing
 */
export declare function computeTimeCost(pricing: PricingConstraints, durationMs: number): number;
/**
 * Extract pricing constraints from a constraint record
 */
export declare function extractPricingConstraints(constraints: Record<string, unknown>): PricingConstraints;
/**
 * Extract SLA constraints from a constraint record
 */
export declare function extractSLAConstraints(constraints: Record<string, unknown>): SLAConstraints;
/**
 * Extract platform fee constraints from a constraint record
 */
export declare function extractPlatformFeeConstraints(constraints: Record<string, unknown>): PlatformFeeConstraints;
//# sourceMappingURL=types.d.ts.map