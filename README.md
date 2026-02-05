# uniplex-mcp-sdk

<!-- mcp-name: io.github.uniplexprotocol/sdk -->

[![npm version](https://img.shields.io/npm/v/uniplex-mcp-sdk)](https://www.npmjs.com/package/uniplex-mcp-sdk)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-green)](https://modelcontextprotocol.io)

**Protect your MCP server with Uniplex.** Add permission verification, constraint enforcement, and a cryptographic audit trail to any tool — in a few lines of code.

Every tool call is checked against the calling agent's passport. Unauthorized requests are denied before your handler ever runs.

---

## What is Uniplex?

[Uniplex](https://uniplex.io) is an open protocol that adds a lightweight trust layer for the agentic web. It has two sides:

**Gates** protect your tools, APIs, and MCP servers. A Gate is a verification checkpoint — you define a permission catalog of what's allowed, and incoming agent requests are checked against it locally, with no network round-trip. Every decision produces a signed attestation for a tamper-evident audit trail.

**Passports** are signed credentials that agents carry. Each passport specifies who issued it, what the agent is allowed to do, and under what constraints — scoped to specific actions, resources, and time windows.

This SDK lets you add a Gate to your MCP server. You define tools, declare the permissions they require, and the SDK handles verification, constraint enforcement, and attestation logging automatically.

→ [Protocol specification](https://github.com/uniplexprotocol/uniplex) · [Documentation](https://uniplex.io) · [Management MCP server](https://github.com/uniplexprotocol/uniplex-mcp-manage)

---

## Installation

```bash
npm install uniplex-mcp-sdk
```

---

## Quick Start

```typescript
import { UniplexMCPServer, defineTool } from 'uniplex-mcp-sdk';

// Define a tool with a required permission
const searchFlights = defineTool()
  .name('search_flights')
  .permission('flights:search')
  .schema({
    type: 'object',
    properties: {
      origin: { type: 'string' },
      destination: { type: 'string' },
      date: { type: 'string', format: 'date' }
    },
    required: ['origin', 'destination', 'date']
  })
  .handler(async (input) => {
    // Your logic here — only runs if the agent's passport allows flights:search
    return { flights: [] };
  })
  .build();

// Create and start the server
const server = new UniplexMCPServer({
  gate_id: 'gate_acme-travel',
  tools: [searchFlights],
  test_mode: true  // Use mock passports for development
});

server.start();
```

That's it. Any agent calling `search_flights` must carry a valid passport with the `flights:search` permission. No valid passport, no execution.

---

## How It Works

1. **Agent calls a tool** — the request includes a passport (signed credential)
2. **Gate checks the passport** — signature valid? Permission granted? Constraints met? Not expired or revoked?
3. **If allowed** — your handler runs, and an attestation is logged
4. **If denied** — the request is rejected before your code executes

All verification happens locally in the request flow. No network calls in the hot path. Sub-millisecond overhead.

---

## Features

### Permission Verification

Every tool declares the permission it requires. The SDK checks the agent's passport against your gate's permission catalog automatically.

```typescript
const bookFlight = defineTool()
  .name('book_flight')
  .permission('flights:book')
  .riskLevel('high')
  // ...
```

### Constraint Enforcement

Go beyond simple allow/deny. Enforce cost limits, rate limits, and custom constraints that are checked against values in the passport:

```typescript
const bookFlight = defineTool()
  .name('book_flight')
  .permission('flights:book')
  .riskLevel('high')
  .constraint({
    key: 'core:cost:max',
    source: 'input',
    input_path: '$.price',
    transform: 'dollars_to_cents'
  })
  .schema({
    type: 'object',
    properties: {
      flight_id: { type: 'string' },
      price: { type: 'string' }  // Use string for financial values
    },
    required: ['flight_id', 'price']
  })
  .handler(async (input) => {
    return { confirmation: 'ABC123' };
  })
  .build();
```

### Attestation Logging

Every gate decision — allowed or denied — produces a signed attestation. This gives you a tamper-evident audit trail of every agent action across your tools.

### Local-First Verification

Passport verification runs locally in the request flow. No network calls on the hot path. Designed for sub-millisecond overhead.

---

## Commerce

Enable metered billing for your tools with consumption attestations. When an agent uses a paid tool, the gate issues a cryptographic receipt that both sides can verify.

### Enable Commerce

```typescript
const server = new UniplexMCPServer({
  gate_id: 'gate_weather-api',
  tools: [forecastTool],
  commerce: {
    enabled: true,
    issue_receipts: true  // Auto-issue consumption attestations
  }
});
```

### Issue and Verify Receipts

```typescript
import { 
  issueConsumptionAttestation, 
  verifyConsumptionAttestation,
  generateRequestNonce,
  aggregateAttestations,
  computePlatformFee 
} from 'uniplex-mcp-sdk';

// Gate issues receipt after tool execution
const receipt = await issueConsumptionAttestation({
  gate_id: 'gate_weather-api',
  agent_id: 'agent_travel-planner',
  passport_id: 'passport_123',
  permission_key: 'weather:forecast',
  catalog_version: 1,
  effective_constraints: {
    'core:pricing:per_call_cents': 10,
    'core:pricing:currency': 'USD',
    'core:platform_fee:basis_points': 200  // 2%
  },
  sign: async (payload) => signWithGateKey(payload),
  signing_key_id: 'gate_weather-api#key-1'
});

// Agent verifies receipt
const nonce = generateRequestNonce('agent_travel-planner');
const verification = await verifyConsumptionAttestation({
  attestation: receipt,
  expected_nonce: nonce.nonce,
  gate_public_key: gatePublicKey,
  verify: async (payload, sig, key) => verifySignature(payload, sig, key)
});

// Aggregate for billing
const billing = aggregateAttestations(receipts, '2026-02-01', '2026-02-28');
// → { total_calls: 150, total_cost_cents: 1500, total_platform_fee_cents: 30 }
```

### Commerce Types

```typescript
import type {
  ConsumptionAttestation,  // Receipt after tool execution
  ConsumptionData,         // Units, cost, timestamp
  PricingConstraints,      // per_call_cents, per_minute_cents, currency
  SLAConstraints,          // uptime_basis_points, response_time_ms
  PlatformFeeConstraints,  // basis_points, recipient
  BillingPeriod,           // Aggregated settlement
  RequestNonce,            // For bilateral verification
  DiscoveryQuery,          // Find services by price/capability
  DiscoveryResult          // Matching gates
} from 'uniplex-mcp-sdk';
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UNIPLEX_GATE_ID` | Yes | Your gate identifier |
| `UNIPLEX_API_URL` | No | API URL (default: `https://api.uniplex.ai`) |

### Server Options

```typescript
const server = new UniplexMCPServer({
  gate_id: 'gate_acme-travel',
  tools: [searchFlights, bookFlight],
  
  test_mode: true,              // Mock passports for development
  cache: {
    catalog_ttl_ms: 300000,     // 5 minutes
    revocation_ttl_ms: 60000    // 1 minute
  }
});
```

---

## Claude Desktop Integration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "travel": {
      "command": "node",
      "args": ["./dist/server.js"],
      "env": {
        "UNIPLEX_GATE_ID": "gate_acme-travel"
      }
    }
  }
}
```

---

## API Reference

### `defineTool()`

Fluent builder for tool definitions:

```typescript
defineTool()
  .name(string)                                  // Tool name
  .permission(string)                            // Required permission (e.g., 'flights:book')
  .riskLevel('low' | 'medium' | 'high' | 'critical')
  .schema(JSONSchema)                            // Input schema
  .constraint(ConstraintConfig)                  // Add constraint enforcement
  .handler(async (input) => {})                  // Tool implementation
  .build()                                       // Returns ToolDefinition
```

### `UniplexMCPServer`

```typescript
new UniplexMCPServer(config: ServerConfig)

server.start()                // Start stdio transport
server.registerTool(tool)     // Add tool at runtime
```

### Financial Utilities

```typescript
import { transformToCanonical, dollarsToCents } from 'uniplex-mcp-sdk';

transformToCanonical('4.99', 2)           // → 499
transformToCanonical('1.005', 2, 'round') // → 101
dollarsToCents('19.99')                   // → 1999
```

### Commerce Functions

```typescript
import { 
  issueConsumptionAttestation,   // Gate issues receipt
  verifyConsumptionAttestation,  // Agent verifies receipt
  generateRequestNonce,          // Create nonce for bilateral verification
  aggregateAttestations,         // Sum receipts for billing period
  computePlatformFee,            // Calculate fee (ceiling rounding)
  computeCallCost,               // Cost for per-call pricing
  computeTimeCost,               // Cost for per-minute pricing
  matchesDiscoveryCriteria,      // Check if service matches price/currency
  meetsSLARequirements           // Check if service meets uptime/latency
} from 'uniplex-mcp-sdk';
```

---

## Testing

```bash
npm test
```

Use `test_mode: true` in your server config to run with mock passports during development — no real gate or issuer needed.

---

## Learn More

- [Uniplex Protocol Specification](https://github.com/uniplexprotocol/uniplex)
- [Documentation & Guides](https://uniplex.io)
- [Management MCP Server](https://github.com/uniplexprotocol/uniplex-mcp-manage) — manage issuers, passports, and gates from Claude
- [💬 Discussions](https://github.com/uniplexprotocol/uniplex/discussions) — Questions and ideas
- [𝕏 @uniplexprotocol](https://x.com/uniplexprotocol) — Updates and announcements

---

## License

Apache 2.0 — [Standard Logic Co.](https://standardlogic.ai)

Building the trust infrastructure for AI agents.
