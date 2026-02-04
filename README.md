# uniplex-mcp-sdk

Permission-aware MCP server SDK for AI agent tool execution. Enables AI agents (Claude, ChatGPT, custom agents) to discover, request, and use permissions through Uniplex-protected tools.

## Installation

```bash
npm install uniplex-mcp-sdk
```

## Quick Start

```typescript
import { UniplexMCPServer, defineTool } from 'uniplex-mcp-sdk';

// Define your tool
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
    // Your API call here
    return { flights: [] };
  })
  .build();

// Create and run server
const server = new UniplexMCPServer({
  gate_id: 'gate_acme-travel',
  tools: [searchFlights],
  test_mode: true  // Use mock data for development
});

server.start();
```

## Features

- **Permission Verification** — Every tool call verified against agent passports
- **Constraint Enforcement** — Rate limits, cost caps, and custom constraints
- **Local-First** — Hot path verification with no network calls (<1ms)
- **Attestation Logging** — Cryptographic audit trail for every action
- **Commerce Support** — Consumption attestations, billing, and service discovery

## Commerce (Uni-Commerce Profile)

Enable metered billing for your tools with consumption attestations:

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

// Platform fee uses ceiling rounding
computePlatformFee(1000, 200);  // 2% of $10 = 20 cents
computePlatformFee(101, 200);   // 2% of $1.01 = 3 cents (ceiling)
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

### Enable Commerce in Server

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

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UNIPLEX_GATE_ID` | Yes | Your gate identifier |
| `UNIPLEX_API_URL` | No | API URL (default: https://api.uniplex.ai) |

### Server Options

```typescript
const server = new UniplexMCPServer({
  gate_id: 'gate_acme-travel',
  tools: [searchFlights, bookFlight],
  
  // Optional
  test_mode: true,              // Mock passports for development
  cache: {
    catalog_ttl_ms: 300000,     // 5 minutes
    revocation_ttl_ms: 60000    // 1 minute
  }
});
```

## Adding Constraints

Tools can enforce constraints like cost limits:

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
    // Book the flight
    return { confirmation: 'ABC123' };
  })
  .build();
```

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

## API Reference

### `defineTool()`

Fluent builder for tool definitions:

```typescript
defineTool()
  .name(string)                    // Tool name
  .permission(string)              // Permission key (e.g., 'flights:book')
  .riskLevel('low'|'medium'|'high'|'critical')
  .schema(JSONSchema)              // Input schema
  .constraint(ConstraintConfig)    // Add constraint
  .handler(async (input) => {})    // Tool implementation
  .build()                         // Returns ToolDefinition
```

### `UniplexMCPServer`

```typescript
new UniplexMCPServer(config: ServerConfig)

server.start()                     // Start stdio transport
server.registerTool(tool)          // Add tool at runtime
```

### `transformToCanonical()`

Convert financial values to integers:

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

## Testing

```bash
npm test
```

## License

Apache 2.0

---

*Standard Logic Co. — Building the trust infrastructure for AI agents*
