/**
 * Uniplex MCP Server Type Definitions
 * Version: 1.0.0 (2026-02-03)
 * 
 * Implements types from Uniplex MCP Server Specification v1.0.0
 * Cross-references: Permission Catalog Spec v1.2.4
 */

// =============================================================================
// DENIAL CODES (matches Permission Catalog DenialCode enum)
// =============================================================================

export type DenialCode =
  | 'NO_PASSPORT'
  | 'ISSUER_NOT_TRUSTED'
  | 'INVALID_SIGNATURE'
  | 'PASSPORT_EXPIRED'
  | 'PASSPORT_REVOKED'
  | 'PERMISSION_NOT_IN_CATALOG'
  | 'PERMISSION_NOT_IN_PASSPORT'
  | 'CONSTRAINT_EXCEEDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'APPROVAL_REQUIRED'
  | 'CATALOG_VERSION_DEPRECATED'
  | 'CATALOG_VERSION_UNKNOWN'
  | 'CATALOG_VERSION_STALE';

// =============================================================================
// MCP ERROR CODES
// =============================================================================

export type UniplexMCPError =
  | 'UNIPLEX_UNAVAILABLE'
  | 'GATE_NOT_FOUND'
  | 'PASSPORT_INVALID'
  | 'PASSPORT_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'CONSTRAINT_EXCEEDED'
  | 'APPROVAL_REQUIRED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CATALOG_VERSION_DEPRECATED'
  | 'CATALOG_VERSION_UNKNOWN'
  | 'CATALOG_VERSION_STALE';

// =============================================================================
// TRANSFORM MODE
// =============================================================================

export type TransformMode = 'strict' | 'round' | 'truncate';

// =============================================================================
// CONSTRAINT TYPES (Section 2.4 Commerce Constraint Namespaces)
// =============================================================================

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
export const CONSTRAINT_TYPES: Record<string, ConstraintTypeDefinition> = {
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
// PASSPORT
// =============================================================================

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
  expires_at: string;  // RFC3339 timestamp
  issued_at: string;   // RFC3339 timestamp
  catalog_version_pin?: Record<string, number>;  // gate_id -> version
  
  // Computed at load time for O(1) lookup
  claimsByKey: Record<string, PassportPermission>;
}

// =============================================================================
// CATALOG
// =============================================================================

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
  cached_at: number;  // Unix timestamp
  
  // Alias for current.permissionsByKey
  permissionsByKey: Record<string, CatalogPermission>;
}

// =============================================================================
// VERIFICATION
// =============================================================================

export interface VerifyDenial {
  code: DenialCode;
  message: string;
  upgrade_template?: string;
}

export interface VerifyResult {
  allowed: boolean;
  denial?: VerifyDenial;
  effective_constraints?: Record<string, unknown>;
  confident: boolean;  // true if cache was fresh enough
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

// =============================================================================
// RATE LIMITING
// =============================================================================

export interface RateLimiter {
  check(action: string, passportId?: string): boolean;
  increment(action: string, passportId?: string): void;
  reset(action: string, passportId?: string): void;
}

// =============================================================================
// TOOL DEFINITION
// =============================================================================

export interface ConstraintMapping {
  key: string;
  source: 'input' | 'fixed';
  input_path?: string;  // JSON path (e.g., "$.price")
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

// Alias for consistency with spec naming
export type ToolMapping = ToolDefinition;

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  [key: string]: unknown;
}

// =============================================================================
// SESSION
// =============================================================================

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

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

export interface SafeDefaultConfig {
  enabled: boolean;
  auto_issue: boolean;
  permissions: string[];
  constraints: Record<string, unknown>;
  max_lifetime: string;  // ISO 8601 duration
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
  sample_rate: number;  // 0.0 to 1.0
  always_log_denials: boolean;
}

export interface SessionDigestConfig {
  commit_interval_seconds: number;
  include_tool_hashes: boolean;
}

export interface CommerceConfig {
  enabled: boolean;
  issue_receipts: boolean;  // Issue consumption attestations after tool execution
  signing_key_id?: string;  // Key ID for signing attestations
}

export interface UniplexMCPServerConfig {
  // Uniplex connection
  uniplex_api_url: string;
  gate_id: string;
  gate_secret?: string;  // For server-side operations (NEVER in client configs)
  signing_key_id?: string;  // Key ID for signing attestations
  
  // Safe default settings
  safe_default: SafeDefaultConfig;
  
  // Swarm support
  swarm?: SwarmConfig;
  
  // Issuer trust
  trusted_issuers: string[];
  trust_networks?: string[];
  
  // Tool mappings
  tools: ToolMapping[];
  
  // Cache settings
  cache?: CacheConfig;
  
  // Audit settings
  audit?: AuditConfig;
  
  // Commerce settings (Uni-Commerce profile)
  commerce?: CommerceConfig;
  
  // Test mode
  test_mode?: {
    enabled: boolean;
    mock_passport?: {
      permissions: string[];
      constraints: Record<string, unknown>;
    };
  };
}

// =============================================================================
// MCP PROTOCOL EXTENSIONS
// =============================================================================

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

// =============================================================================
// TOOL RESPONSE EXTENSIONS
// =============================================================================

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

// =============================================================================
// ATTESTATION
// =============================================================================

export interface Attestation {
  attestation_id: string;
  gate_id: string;
  passport_id: string;
  action: string;
  result: 'allowed' | 'denied';
  denial_code?: DenialCode;
  context: Record<string, unknown>;
  timestamp: string;  // RFC3339
  attestation_json: string;  // Canonical JSON - MUST NOT be recomputed
  signature: string;
}

// =============================================================================
// COMMERCE TYPES (Uni-Commerce Profile)
// =============================================================================

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
  currency?: string;  // ISO 4217 (e.g., "USD")
  free_tier_calls?: number;
}

/**
 * SLA constraints extracted from catalog
 */
export interface SLAConstraints {
  uptime_basis_points?: number;     // 99.95% = 9995
  response_time_ms?: number;
  p99_response_ms?: number;
  guaranteed_response_ms?: number;
}

/**
 * Platform fee configuration
 */
export interface PlatformFeeConstraints {
  basis_points?: number;  // 2% = 200
  recipient?: string;     // Gate ID of fee recipient
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
  timestamp: string;  // RFC3339
  duration_ms?: number;  // For per-minute pricing
}

/**
 * Request nonce from agent for bilateral verification
 * Cross-ref: Patent #27, Section 2.1
 */
export interface RequestNonce {
  nonce: string;        // Random string from agent
  timestamp: string;    // When agent generated nonce
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
  
  // Bilateral verification: echo agent's nonce
  request_nonce?: string;
  
  // Commercial terms at time of transaction
  effective_constraints: {
    pricing?: PricingConstraints;
    platform_fee?: PlatformFeeConstraints;
  };
  
  // Consumption details
  consumption: ConsumptionData;
  
  // Cryptographic proof
  proof: {
    type: 'JWS';
    kid: string;  // Key ID (e.g., "gate_weather-pro#key-1")
    sig: string;  // BASE64URL signature
  };
}

/**
 * Discovery query for finding services
 * Cross-ref: Patent #26, Section 2.5
 */
export interface DiscoveryQuery {
  capability?: string;           // Wildcard pattern (e.g., "weather:*")
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
  period_start: string;  // RFC3339
  period_end: string;    // RFC3339
  agent_id: string;
  gate_id: string;
  
  // Aggregated totals
  total_calls: number;
  total_cost_cents: number;
  total_platform_fee_cents: number;
  
  // Attestation references for audit
  attestation_ids: string[];
  
  // Merkle root for session digest mode
  merkle_root?: string;
}

// =============================================================================
// COMMERCE FUNCTIONS
// =============================================================================

/**
 * Platform fee computation (Normative)
 * fee_cents = ceil(service_cost_cents * basis_points / 10000)
 * Cross-ref: Patent #27, Section 4.1
 */
export function computePlatformFee(serviceCostCents: number, basisPoints: number): number {
  if (serviceCostCents < 0) throw new Error('Cost cannot be negative');
  if (basisPoints < 0) throw new Error('Basis points cannot be negative');
  return Math.ceil(serviceCostCents * basisPoints / 10000);
}

/**
 * Compute cost for a single call based on pricing constraints
 */
export function computeCallCost(pricing: PricingConstraints, units: number = 1): number {
  if (pricing.per_call_cents !== undefined) {
    return pricing.per_call_cents * units;
  }
  return 0;
}

/**
 * Compute cost for time-based pricing
 */
export function computeTimeCost(pricing: PricingConstraints, durationMs: number): number {
  if (pricing.per_minute_cents !== undefined) {
    const minutes = Math.ceil(durationMs / 60000);
    return pricing.per_minute_cents * minutes;
  }
  return 0;
}

/**
 * Extract pricing constraints from a constraint record
 */
export function extractPricingConstraints(constraints: Record<string, unknown>): PricingConstraints {
  return {
    per_call_cents: constraints['core:pricing:per_call_cents'] as number | undefined,
    per_minute_cents: constraints['core:pricing:per_minute_cents'] as number | undefined,
    subscription_cents: constraints['core:pricing:subscription_cents'] as number | undefined,
    model: constraints['core:pricing:model'] as PricingModel | undefined,
    currency: constraints['core:pricing:currency'] as string | undefined,
    free_tier_calls: constraints['core:pricing:free_tier_calls'] as number | undefined,
  };
}

/**
 * Extract SLA constraints from a constraint record
 */
export function extractSLAConstraints(constraints: Record<string, unknown>): SLAConstraints {
  return {
    uptime_basis_points: constraints['core:sla:uptime_basis_points'] as number | undefined,
    response_time_ms: constraints['core:sla:response_time_ms'] as number | undefined,
    p99_response_ms: constraints['core:sla:p99_response_ms'] as number | undefined,
    guaranteed_response_ms: constraints['core:sla:guaranteed_response_ms'] as number | undefined,
  };
}

/**
 * Extract platform fee constraints from a constraint record
 */
export function extractPlatformFeeConstraints(constraints: Record<string, unknown>): PlatformFeeConstraints {
  return {
    basis_points: constraints['core:platform_fee:basis_points'] as number | undefined,
    recipient: constraints['core:platform_fee:recipient'] as string | undefined,
  };
}
