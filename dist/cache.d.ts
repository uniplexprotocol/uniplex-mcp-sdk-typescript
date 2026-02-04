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
import { CachedCatalog, CatalogPermission, CatalogVersion, UniplexMCPServerConfig } from './types.js';
export interface CacheState {
    catalog: CachedCatalog | null;
    revocationList: Set<string>;
    revocationCachedAt: number;
    issuerKeys: Record<string, string>;
    issuerKeysCachedAt: number;
}
export declare class CacheManager {
    private state;
    private config;
    private apiUrl;
    private gateId;
    private refreshIntervals;
    constructor(serverConfig: UniplexMCPServerConfig);
    get catalog(): CachedCatalog | null;
    get revocationList(): Set<string>;
    get issuerKeys(): Record<string, string>;
    isCatalogFresh(): boolean;
    isRevocationListFresh(action?: string): boolean;
    getFailMode(action?: string): 'fail_open' | 'fail_closed';
    getCatalogVersion(): number | undefined;
    getCatalogContentHash(): string | undefined;
    updateCatalog(catalog: CachedCatalog): void;
    updateRevocationList(revocations: string[]): void;
    updateIssuerKeys(keys: Record<string, string>): void;
    startBackgroundRefresh(): Promise<void>;
    stopBackgroundRefresh(): void;
    refreshAll(): Promise<void>;
    refreshCatalog(): Promise<void>;
    refreshRevocations(): Promise<void>;
    refreshIssuerKeys(): Promise<void>;
    private buildPermissionIndex;
    resolveCatalogVersion(passport: {
        catalog_version_pin?: Record<string, number>;
    } | null): CatalogVersion | null;
}
export declare function createMockCache(permissions: CatalogPermission[], issuerKeys?: Record<string, string>, revocations?: string[]): CacheManager;
//# sourceMappingURL=cache.d.ts.map