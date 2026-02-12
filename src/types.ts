/**
 * Uniplex MCP Server Type Definitions
 * Version: 1.2.0
 *
 * Shared protocol types are imported from the `uniplex` protocol SDK.
 * MCP-specific types are defined here.
 */

// =============================================================================
// RE-EXPORTS FROM PROTOCOL SDK
// =============================================================================

export {
  DenyReason,
  type AnonymousAccessPolicy,
  type AnonymousDecision,
  type AnonymousRateLimiter,
  type CELResult,
  type ConstraintDecision,
  type ConstraintEvaluation,
  type ConstraintSet,
  type CumulativeState,
  type ObligationToken,
  type ConstraintKey,
} from 'uniplex';

export {
  OBLIGATION_TOKENS,
  CONSTRAINT_KEYS,
  evaluateConstraints,
  CumulativeStateTracker,
} from 'uniplex';

export {
  evaluateAnonymousAccess,
  MemoryAnonymousRateLimiter,
} from 'uniplex';

import { DenyReason, type ConstraintDecision } from 'uniplex';

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
 * Constraint type registry — defines limit vs term constraints.
 *
 * - limit: access control constraints (min-merge, passport can restrict)
 * - term:  commercial terms (gate-authoritative, credentials bind TO)
 *
 * Key names align with CONSTRAINT_KEYS from the protocol SDK.
 */
export const CONSTRAINT_TYPES: Record<string, ConstraintTypeDefinition> = {
  // Access control constraints (limit type)
  'core:rate:max_per_minute': { type: 'limit', valueType: 'integer' },
  'core:rate:max_per_hour': { type: 'limit', valueType: 'integer' },
  'core:rate:max_per_day': { type: 'limit', valueType: 'integer' },
  'core:cost:max_per_action': { type: 'limit', valueType: 'integer' },
  'core:cost:max_cumulative': { type: 'limit', valueType: 'integer' },

  // Commerce constraints (term type)
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
// DENIAL CODE — backward-compatible alias for DenyReason
// =============================================================================

/**
 * DenialCode is the legacy name used throughout this SDK.
 * It is now an alias for protocol SDK's DenyReason enum.
 */
export type DenialCode = DenyReason;
export const DenialCode = DenyReason;

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
  code: DenyReason;
  message: string;
  upgrade_template?: string;
}

/**
 * Result of local verification.
 *
 * Three-tier decision model (§14B.2):
 *   BLOCK   → wire "deny", no obligations
 *   SUSPEND → wire "deny", obligations=["require_approval"], reason_codes=["approval_required"]
 *   PERMIT  → wire "permit"
 *
 * `allowed` is kept for backward compatibility: true iff decision === 'permit'.
 */
export interface VerifyResult {
  /** Backward-compatible flag: true when decision is "permit". */
  allowed: boolean;
  /** Wire-level decision: "permit" or "deny". */
  decision: 'permit' | 'deny';
  /** Internal three-tier decision from CEL. */
  constraint_decision?: ConstraintDecision;
  /** Populated on SUSPEND: ["approval_required"]. */
  reason_codes?: string[];
  /** Populated on SUSPEND: ["require_approval"]. */
  obligations?: string[];
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
  issue_receipts: boolean;
  signing_key_id?: string;
}

// Anonymous access policy is imported from protocol SDK (AnonymousAccessPolicy).
// We alias it in server config under the name `anonymous`.
import type { AnonymousAccessPolicy } from 'uniplex';

export interface UniplexMCPServerConfig {
  // Uniplex connection
  uniplex_api_url: string;
  gate_id: string;
  gate_secret?: string;
  signing_key_id?: string;

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

  // Anonymous access policy (§14A)
  anonymous?: AnonymousAccessPolicy;

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
  denial_code: DenyReason;
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
  denial_code?: DenyReason;
  context: Record<string, unknown>;
  timestamp: string;  // RFC3339
  attestation_json: string;
  signature: string;
}

// =============================================================================
// COMMERCE TYPES (Uni-Commerce Profile)
// =============================================================================

export type PricingModel = 'per_call' | 'per_minute' | 'subscription' | 'usage';

export interface PricingConstraints {
  per_call_cents?: number;
  per_minute_cents?: number;
  subscription_cents?: number;
  model?: PricingModel;
  currency?: string;
  free_tier_calls?: number;
}

export interface SLAConstraints {
  uptime_basis_points?: number;
  response_time_ms?: number;
  p99_response_ms?: number;
  guaranteed_response_ms?: number;
}

export interface PlatformFeeConstraints {
  basis_points?: number;
  recipient?: string;
}

export interface ServiceAdvertisement {
  permission_key: string;
  display_name: string;
  description?: string;
  trust_level_required?: number;
  pricing: PricingConstraints;
  sla?: SLAConstraints;
  platform_fee?: PlatformFeeConstraints;
}

export interface ConsumptionData {
  units: number;
  cost_cents: number;
  platform_fee_cents: number;
  timestamp: string;
  duration_ms?: number;
}

export interface RequestNonce {
  nonce: string;
  timestamp: string;
  agent_id: string;
}

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

export interface DiscoveryQuery {
  capability?: string;
  max_price_cents?: number;
  min_uptime_basis_points?: number;
  min_trust_level?: number;
  currency?: string;
  limit?: number;
  offset?: number;
}

export interface DiscoveryResult {
  gate_id: string;
  gate_name?: string;
  trust_level: number;
  services: ServiceAdvertisement[];
  catalog_version: number;
  catalog_content_hash?: string;
}

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

// =============================================================================
// COMMERCE FUNCTIONS
// =============================================================================

export function computePlatformFee(serviceCostCents: number, basisPoints: number): number {
  if (serviceCostCents < 0) throw new Error('Cost cannot be negative');
  if (basisPoints < 0) throw new Error('Basis points cannot be negative');
  return Math.ceil(serviceCostCents * basisPoints / 10000);
}

export function computeCallCost(pricing: PricingConstraints, units: number = 1): number {
  if (pricing.per_call_cents !== undefined) {
    return pricing.per_call_cents * units;
  }
  return 0;
}

export function computeTimeCost(pricing: PricingConstraints, durationMs: number): number {
  if (pricing.per_minute_cents !== undefined) {
    const minutes = Math.ceil(durationMs / 60000);
    return pricing.per_minute_cents * minutes;
  }
  return 0;
}

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

export function extractSLAConstraints(constraints: Record<string, unknown>): SLAConstraints {
  return {
    uptime_basis_points: constraints['core:sla:uptime_basis_points'] as number | undefined,
    response_time_ms: constraints['core:sla:response_time_ms'] as number | undefined,
    p99_response_ms: constraints['core:sla:p99_response_ms'] as number | undefined,
    guaranteed_response_ms: constraints['core:sla:guaranteed_response_ms'] as number | undefined,
  };
}

export function extractPlatformFeeConstraints(constraints: Record<string, unknown>): PlatformFeeConstraints {
  return {
    basis_points: constraints['core:platform_fee:basis_points'] as number | undefined,
    recipient: constraints['core:platform_fee:recipient'] as string | undefined,
  };
}
