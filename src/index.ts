#!/usr/bin/env node
/**
 * Uniplex MCP Server - Entry Point
 * Version: 1.2.0
 *
 * Usage:
 *   npx uniplex-mcp-sdk --config config.json
 *   uniplex-mcp-server --config config.json
 */

import { UniplexMCPServer } from './server.js';
import { UniplexMCPServerConfig, ToolDefinition } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// =============================================================================
// CONFIG LOADING
// =============================================================================

function loadConfig(): UniplexMCPServerConfig {
  // Check for --config argument
  const configArgIndex = process.argv.findIndex(arg => arg === '--config' || arg === '-c');
  let configPath: string | undefined;

  if (configArgIndex !== -1 && process.argv[configArgIndex + 1]) {
    configPath = process.argv[configArgIndex + 1];
  } else {
    // Default config paths
    const defaultPaths = [
      'uniplex-mcp-config.json',
      'config.json',
      '.uniplex/mcp-config.json',
    ];

    for (const path of defaultPaths) {
      if (existsSync(path)) {
        configPath = path;
        break;
      }
    }
  }

  if (configPath && existsSync(configPath)) {
    const content = readFileSync(resolve(configPath), 'utf-8');
    const config = JSON.parse(content);

    // Load tool handlers if specified as module paths
    if (config.tools) {
      config.tools = config.tools.map((tool: any) => {
        if (typeof tool.handler === 'string') {
          tool.handler = async (input: unknown) => {
            throw new Error(`Handler module ${tool.handler} not loaded`);
          };
        }
        return tool;
      });
    }

    return config;
  }

  // Environment-based config
  const gateId = process.env.UNIPLEX_GATE_ID;
  const apiUrl = process.env.UNIPLEX_API_URL ?? 'https://api.uniplex.dev';

  if (!gateId) {
    console.error('Error: No config file found and UNIPLEX_GATE_ID not set');
    console.error('Usage: uniplex-mcp-server --config config.json');
    console.error('   or: UNIPLEX_GATE_ID=gate_xxx uniplex-mcp-server');
    process.exit(1);
  }

  return {
    gate_id: gateId,
    uniplex_api_url: apiUrl,
    gate_secret: process.env.UNIPLEX_GATE_SECRET,
    trusted_issuers: (process.env.UNIPLEX_TRUSTED_ISSUERS ?? '').split(',').filter(Boolean),
    safe_default: {
      enabled: process.env.UNIPLEX_SAFE_DEFAULT !== 'false',
      auto_issue: process.env.UNIPLEX_SAFE_DEFAULT_AUTO !== 'false',
      permissions: (process.env.UNIPLEX_SAFE_DEFAULT_PERMISSIONS ?? '').split(',').filter(Boolean),
      constraints: {},
      max_lifetime: process.env.UNIPLEX_SAFE_DEFAULT_LIFETIME ?? 'PT1H',
    },
    tools: [],
    audit: {
      enabled: process.env.UNIPLEX_AUDIT !== 'false',
      log_inputs: process.env.UNIPLEX_AUDIT_INPUTS === 'true',
      log_outputs: process.env.UNIPLEX_AUDIT_OUTPUTS === 'true',
      webhook_url: process.env.UNIPLEX_AUDIT_WEBHOOK,
    },
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  // Check for help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Uniplex MCP Server v1.2.0

USAGE:
  uniplex-mcp-server [OPTIONS]

OPTIONS:
  -c, --config <path>   Path to config file (JSON)
  -h, --help           Show this help message
  -v, --version        Show version

ENVIRONMENT VARIABLES:
  UNIPLEX_GATE_ID              Gate ID (required if no config file)
  UNIPLEX_API_URL              Uniplex API URL (default: https://api.uniplex.dev)
  UNIPLEX_GATE_SECRET          Gate secret for server-side operations
  UNIPLEX_TRUSTED_ISSUERS      Comma-separated list of trusted issuer IDs
  UNIPLEX_SAFE_DEFAULT         Enable safe default passports (default: true)
  UNIPLEX_AUDIT                Enable audit logging (default: true)

EXAMPLES:
  # With config file
  uniplex-mcp-server --config ./config.json

  # With environment variables
  UNIPLEX_GATE_ID=gate_travel uniplex-mcp-server

CONFIG FILE FORMAT:
  {
    "gate_id": "gate_my-api",
    "uniplex_api_url": "https://api.uniplex.dev",
    "safe_default": {
      "enabled": true,
      "auto_issue": true,
      "permissions": ["search:*"],
      "constraints": {}
    },
    "tools": [
      {
        "name": "search_flights",
        "permission_key": "flights:search",
        "handler": "./handlers/search.js"
      }
    ]
  }
`);
    process.exit(0);
  }

  // Check for version
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log('1.2.0');
    process.exit(0);
  }

  // Load config and start server
  const config = loadConfig();
  const server = new UniplexMCPServer(config);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.error('\nShutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('\nShutting down...');
    await server.stop();
    process.exit(0);
  });

  // Run server
  await server.run();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// =============================================================================
// RE-EXPORTS
// =============================================================================

export { UniplexMCPServer } from './server.js';
export { UniplexMCPServerConfig, ToolDefinition } from './types.js';
export { transformToCanonical, dollarsToCents } from './transforms.js';
export { verifyLocally, InMemoryRateLimiter } from './verification.js';
export { CacheManager } from './cache.js';
export { SessionManager } from './session.js';
export { defineTool, ToolBuilder, ToolRegistry, buildRequestContext } from './tools/wrapper.js';

// Commerce exports (Uni-Commerce profile)
export {
  issueConsumptionAttestation,
  verifyConsumptionAttestation,
  generateRequestNonce,
  aggregateAttestations,
  matchesDiscoveryCriteria,
  meetsSLARequirements,
} from './commerce.js';

// Protocol SDK re-exports (§14A, §14B)
export {
  DenyReason,
  DenialCode,
  OBLIGATION_TOKENS,
  CONSTRAINT_KEYS,
  evaluateConstraints,
  evaluateAnonymousAccess,
  MemoryAnonymousRateLimiter,
  CumulativeStateTracker,
  CONSTRAINT_TYPES,
} from './types.js';

export type {
  AnonymousAccessPolicy,
  AnonymousDecision,
  AnonymousRateLimiter,
  CELResult,
  ConstraintDecision,
  ConstraintEvaluation,
  ConstraintSet,
  CumulativeState,
  ObligationToken,
  ConstraintKey,
  VerifyResult,
} from './types.js';

// Export remaining types
export type {
  Passport,
  CachedCatalog,
  CatalogPermission,
  CatalogVersion,
  VerifyDenial,
  RateLimiter,
  ConstraintMapping,
  Session,
  SessionState,
  SafeDefaultConfig,
  CacheConfig,
  AuditConfig,
  CommerceConfig,
  ServerCapabilities,
  UniplexCapabilities,
  Attestation,
  ConsumptionAttestation,
  ConsumptionData,
  PricingConstraints,
  PlatformFeeConstraints,
  RequestNonce,
  BillingPeriod,
  RequestContext,
  ToolMapping,
  JSONSchema,
  PricingModel,
  SLAConstraints,
  ServiceAdvertisement,
  DiscoveryQuery,
  DiscoveryResult,
  TransformMode,
} from './types.js';
