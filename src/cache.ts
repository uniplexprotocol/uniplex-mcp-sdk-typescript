/**
 * Uniplex MCP Server - Cache Module
 * Version: 1.0.0
 * 
 * Manages cached data for local verification:
 * - Permission catalog
 * - Revocation list
 * - Issuer public keys
 * 
 * Cross-ref: MCP Server Spec Section 1.3 (Local-First Verification)
 */

import {
  CachedCatalog,
  CatalogPermission,
  CatalogVersion,
  CacheConfig,
  UniplexMCPServerConfig,
} from './types.js';

// Default cache configuration
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  catalog_max_age_minutes: 5,
  revocation_max_age_minutes: 1,
  fail_mode: 'fail_open',
};

export interface CacheState {
  catalog: CachedCatalog | null;
  revocationList: Set<string>;
  revocationCachedAt: number;
  issuerKeys: Record<string, string>;
  issuerKeysCachedAt: number;
}

export class CacheManager {
  private state: CacheState = {
    catalog: null,
    revocationList: new Set(),
    revocationCachedAt: 0,
    issuerKeys: {},
    issuerKeysCachedAt: 0,
  };
  
  private config: CacheConfig;
  private apiUrl: string;
  private gateId: string;
  private refreshIntervals: NodeJS.Timeout[] = [];
  
  constructor(serverConfig: UniplexMCPServerConfig) {
    this.config = serverConfig.cache ?? DEFAULT_CACHE_CONFIG;
    this.apiUrl = serverConfig.uniplex_api_url;
    this.gateId = serverConfig.gate_id;
  }
  
  // ==========================================================================
  // PUBLIC GETTERS (used by verifyLocally)
  // ==========================================================================
  
  get catalog(): CachedCatalog | null {
    return this.state.catalog;
  }
  
  get revocationList(): Set<string> {
    return this.state.revocationList;
  }
  
  get issuerKeys(): Record<string, string> {
    return this.state.issuerKeys;
  }
  
  // ==========================================================================
  // CACHE FRESHNESS CHECKS
  // ==========================================================================
  
  isCatalogFresh(): boolean {
    if (!this.state.catalog) return false;
    const ageMs = Date.now() - this.state.catalog.cached_at;
    const maxAgeMs = this.config.catalog_max_age_minutes * 60 * 1000;
    return ageMs < maxAgeMs;
  }
  
  isRevocationListFresh(action?: string): boolean {
    const ageMs = Date.now() - this.state.revocationCachedAt;
    
    // Check for per-action overrides
    const override = action ? this.config.fail_mode_overrides?.[action] : undefined;
    const maxAgeMinutes = override?.revocation_max_age_minutes 
      ?? this.config.revocation_max_age_minutes;
    const maxAgeMs = maxAgeMinutes * 60 * 1000;
    
    return ageMs < maxAgeMs;
  }
  
  getFailMode(action?: string): 'fail_open' | 'fail_closed' {
    const override = action ? this.config.fail_mode_overrides?.[action] : undefined;
    return override?.fail_mode ?? this.config.fail_mode;
  }
  
  getCatalogVersion(): number | undefined {
    return this.state.catalog?.current?.version;
  }
  
  getCatalogContentHash(): string | undefined {
    // In production, this would be computed from the catalog content
    // For now, return undefined (optional field)
    return undefined;
  }
  
  // ==========================================================================
  // CACHE UPDATES
  // ==========================================================================
  
  updateCatalog(catalog: CachedCatalog): void {
    // Build permissionsByKey index for O(1) lookup
    const permissionsByKey: Record<string, CatalogPermission> = {};
    for (const perm of Object.values(catalog.current.permissionsByKey)) {
      permissionsByKey[perm.permission_key] = perm;
    }
    
    this.state.catalog = {
      ...catalog,
      cached_at: Date.now(),
      permissionsByKey,
    };
  }
  
  updateRevocationList(revocations: string[]): void {
    this.state.revocationList = new Set(revocations);
    this.state.revocationCachedAt = Date.now();
  }
  
  updateIssuerKeys(keys: Record<string, string>): void {
    this.state.issuerKeys = keys;
    this.state.issuerKeysCachedAt = Date.now();
  }
  
  // ==========================================================================
  // BACKGROUND REFRESH (network calls - NOT hot path)
  // ==========================================================================
  
  async startBackgroundRefresh(): Promise<void> {
    // Initial fetch
    await this.refreshAll();
    
    // Catalog refresh interval
    const catalogInterval = setInterval(
      () => this.refreshCatalog().catch(console.error),
      this.config.catalog_max_age_minutes * 60 * 1000
    );
    this.refreshIntervals.push(catalogInterval);
    
    // Revocation refresh interval (more frequent)
    const revocationInterval = setInterval(
      () => this.refreshRevocations().catch(console.error),
      this.config.revocation_max_age_minutes * 60 * 1000
    );
    this.refreshIntervals.push(revocationInterval);
  }
  
  stopBackgroundRefresh(): void {
    for (const interval of this.refreshIntervals) {
      clearInterval(interval);
    }
    this.refreshIntervals = [];
  }
  
  async refreshAll(): Promise<void> {
    await Promise.all([
      this.refreshCatalog(),
      this.refreshRevocations(),
      this.refreshIssuerKeys(),
    ]);
  }
  
  async refreshCatalog(): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiUrl}/gates/${this.gateId}/catalog`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (!response.ok) {
        throw new Error(`Catalog fetch failed: ${response.status}`);
      }
      
      const data = await response.json() as { version?: number; permissions?: CatalogPermission[]; published_at?: string; min_compatible_version?: number };
      
      // Build catalog structure from API response
      const catalog: CachedCatalog = {
        gate_id: this.gateId,
        current: {
          version: data.version ?? 1,
          permissionsByKey: this.buildPermissionIndex(data.permissions ?? []),
          published_at: data.published_at ?? new Date().toISOString(),
        },
        versions: {},
        min_compatible_version: data.min_compatible_version ?? 1,
        cached_at: Date.now(),
        permissionsByKey: {},
      };
      
      this.updateCatalog(catalog);
    } catch (error) {
      console.error('Failed to refresh catalog:', error);
      // Don't throw - allow continued operation with stale cache
    }
  }
  
  async refreshRevocations(): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiUrl}/gates/${this.gateId}/revocations`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (!response.ok) {
        throw new Error(`Revocation fetch failed: ${response.status}`);
      }
      
      const data = await response.json() as { passport_ids?: string[] };
      this.updateRevocationList(data.passport_ids ?? []);
    } catch (error) {
      console.error('Failed to refresh revocations:', error);
      // Don't throw - allow continued operation with stale cache
    }
  }
  
  async refreshIssuerKeys(): Promise<void> {
    try {
      const response = await fetch(
        `${this.apiUrl}/issuers/keys`,
        { headers: { 'Accept': 'application/json' } }
      );
      
      if (!response.ok) {
        throw new Error(`Issuer keys fetch failed: ${response.status}`);
      }
      
      const data = await response.json() as { keys?: Record<string, string> };
      this.updateIssuerKeys(data.keys ?? {});
    } catch (error) {
      console.error('Failed to refresh issuer keys:', error);
      // Don't throw - allow continued operation with stale cache
    }
  }
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  private buildPermissionIndex(
    permissions: Array<{
      permission_key: string;
      display_name?: string;
      description?: string;
      risk_level?: string;
      constraints?: Record<string, unknown>;
      default_template?: string;
      required_constraints?: string[];
    }>
  ): Record<string, CatalogPermission> {
    const index: Record<string, CatalogPermission> = {};
    
    for (const perm of permissions) {
      index[perm.permission_key] = {
        permission_key: perm.permission_key,
        display_name: perm.display_name ?? perm.permission_key,
        description: perm.description,
        risk_level: (perm.risk_level as CatalogPermission['risk_level']) ?? 'low',
        constraints: perm.constraints ?? {},
        default_template: perm.default_template,
        required_constraints: perm.required_constraints,
      };
    }
    
    return index;
  }
  
  // ==========================================================================
  // CATALOG VERSION RESOLUTION (Section 16.5 of Permission Catalog Spec)
  // ==========================================================================
  
  resolveCatalogVersion(passport: { catalog_version_pin?: Record<string, number> } | null): CatalogVersion | null {
    if (!this.state.catalog) return null;
    
    const catalog = this.state.catalog;
    
    // No passport or no pin → use current version
    if (!passport?.catalog_version_pin) {
      return catalog.current;
    }
    
    const pin = passport.catalog_version_pin[catalog.gate_id];
    
    // No pin for this gate → use current version
    if (pin === undefined) {
      return catalog.current;
    }
    
    // Check if pinned version is deprecated
    if (pin < catalog.min_compatible_version) {
      // Return null to signal CATALOG_VERSION_DEPRECATED
      return null;
    }
    
    // Try to get pinned version, fall back to current
    return catalog.versions[pin] ?? catalog.current;
  }
}

// =============================================================================
// MOCK CACHE FOR TESTING
// =============================================================================

export function createMockCache(
  permissions: CatalogPermission[],
  issuerKeys: Record<string, string> = {},
  revocations: string[] = []
): CacheManager {
  const mockConfig: UniplexMCPServerConfig = {
    uniplex_api_url: 'https://mock.uniplex.dev',
    gate_id: 'gate_test',
    safe_default: {
      enabled: false,
      auto_issue: false,
      permissions: [],
      constraints: {},
      max_lifetime: 'PT1H',
    },
    trusted_issuers: Object.keys(issuerKeys),
    tools: [],
  };
  
  const cache = new CacheManager(mockConfig);
  
  // Build permission index
  const permissionsByKey: Record<string, CatalogPermission> = {};
  for (const perm of permissions) {
    permissionsByKey[perm.permission_key] = perm;
  }
  
  cache.updateCatalog({
    gate_id: 'gate_test',
    current: {
      version: 1,
      permissionsByKey,
      published_at: new Date().toISOString(),
    },
    versions: {},
    min_compatible_version: 1,
    cached_at: Date.now(),
    permissionsByKey,
  });
  
  cache.updateIssuerKeys(issuerKeys);
  cache.updateRevocationList(revocations);
  
  return cache;
}
