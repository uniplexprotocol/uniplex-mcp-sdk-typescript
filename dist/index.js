#!/usr/bin/env node
"use strict";
/**
 * Uniplex MCP Server - Entry Point
 * Version: 1.0.0
 *
 * Usage:
 *   npx uniplex-mcp-sdk --config config.json
 *   uniplex-mcp-server --config config.json
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetsSLARequirements = exports.matchesDiscoveryCriteria = exports.aggregateAttestations = exports.generateRequestNonce = exports.verifyConsumptionAttestation = exports.issueConsumptionAttestation = exports.buildRequestContext = exports.ToolRegistry = exports.ToolBuilder = exports.defineTool = exports.SessionManager = exports.CacheManager = exports.InMemoryRateLimiter = exports.verifyLocally = exports.dollarsToCents = exports.transformToCanonical = exports.UniplexMCPServer = void 0;
const server_js_1 = require("./server.js");
const fs_1 = require("fs");
const path_1 = require("path");
// =============================================================================
// CONFIG LOADING
// =============================================================================
function loadConfig() {
    // Check for --config argument
    const configArgIndex = process.argv.findIndex(arg => arg === '--config' || arg === '-c');
    let configPath;
    if (configArgIndex !== -1 && process.argv[configArgIndex + 1]) {
        configPath = process.argv[configArgIndex + 1];
    }
    else {
        // Default config paths
        const defaultPaths = [
            'uniplex-mcp-config.json',
            'config.json',
            '.uniplex/mcp-config.json',
        ];
        for (const path of defaultPaths) {
            if ((0, fs_1.existsSync)(path)) {
                configPath = path;
                break;
            }
        }
    }
    if (configPath && (0, fs_1.existsSync)(configPath)) {
        const content = (0, fs_1.readFileSync)((0, path_1.resolve)(configPath), 'utf-8');
        const config = JSON.parse(content);
        // Load tool handlers if specified as module paths
        if (config.tools) {
            config.tools = config.tools.map((tool) => {
                if (typeof tool.handler === 'string') {
                    // Handler is a module path - would need dynamic import
                    // For now, create a placeholder
                    tool.handler = async (input) => {
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
async function main() {
    // Check for help
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(`
Uniplex MCP Server v1.0.0

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
        console.log('1.0.0');
        process.exit(0);
    }
    // Load config and start server
    const config = loadConfig();
    const server = new server_js_1.UniplexMCPServer(config);
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
var server_js_2 = require("./server.js");
Object.defineProperty(exports, "UniplexMCPServer", { enumerable: true, get: function () { return server_js_2.UniplexMCPServer; } });
var transforms_js_1 = require("./transforms.js");
Object.defineProperty(exports, "transformToCanonical", { enumerable: true, get: function () { return transforms_js_1.transformToCanonical; } });
Object.defineProperty(exports, "dollarsToCents", { enumerable: true, get: function () { return transforms_js_1.dollarsToCents; } });
var verification_js_1 = require("./verification.js");
Object.defineProperty(exports, "verifyLocally", { enumerable: true, get: function () { return verification_js_1.verifyLocally; } });
Object.defineProperty(exports, "InMemoryRateLimiter", { enumerable: true, get: function () { return verification_js_1.InMemoryRateLimiter; } });
var cache_js_1 = require("./cache.js");
Object.defineProperty(exports, "CacheManager", { enumerable: true, get: function () { return cache_js_1.CacheManager; } });
var session_js_1 = require("./session.js");
Object.defineProperty(exports, "SessionManager", { enumerable: true, get: function () { return session_js_1.SessionManager; } });
var wrapper_js_1 = require("./tools/wrapper.js");
Object.defineProperty(exports, "defineTool", { enumerable: true, get: function () { return wrapper_js_1.defineTool; } });
Object.defineProperty(exports, "ToolBuilder", { enumerable: true, get: function () { return wrapper_js_1.ToolBuilder; } });
Object.defineProperty(exports, "ToolRegistry", { enumerable: true, get: function () { return wrapper_js_1.ToolRegistry; } });
Object.defineProperty(exports, "buildRequestContext", { enumerable: true, get: function () { return wrapper_js_1.buildRequestContext; } });
// Commerce exports (Uni-Commerce profile)
var commerce_js_1 = require("./commerce.js");
Object.defineProperty(exports, "issueConsumptionAttestation", { enumerable: true, get: function () { return commerce_js_1.issueConsumptionAttestation; } });
Object.defineProperty(exports, "verifyConsumptionAttestation", { enumerable: true, get: function () { return commerce_js_1.verifyConsumptionAttestation; } });
Object.defineProperty(exports, "generateRequestNonce", { enumerable: true, get: function () { return commerce_js_1.generateRequestNonce; } });
Object.defineProperty(exports, "aggregateAttestations", { enumerable: true, get: function () { return commerce_js_1.aggregateAttestations; } });
Object.defineProperty(exports, "matchesDiscoveryCriteria", { enumerable: true, get: function () { return commerce_js_1.matchesDiscoveryCriteria; } });
Object.defineProperty(exports, "meetsSLARequirements", { enumerable: true, get: function () { return commerce_js_1.meetsSLARequirements; } });
// Export types
__exportStar(require("./types.js"), exports);
//# sourceMappingURL=index.js.map