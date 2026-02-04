# Contributing to uniplex-mcp-sdk

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/mcp-server.git`
3. Install dependencies: `npm install`
4. Run tests: `npm test`

## Development

### Project Structure

```
src/
├── index.ts          # Entry point and CLI
├── server.ts         # MCP Server implementation
├── types.ts          # Type definitions
├── transforms.ts     # Financial value transforms
├── verification.ts   # 9-step verification algorithm
├── cache.ts          # Catalog/revocation caching
├── session.ts        # Passport session management
└── tools/
    └── wrapper.ts    # Tool wrapper with permission gates

src/__tests__/
├── transforms.test.ts
└── verification.test.ts
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

### Building

```bash
npm run build         # Compile TypeScript to dist/
```

### Code Style

- Use TypeScript strict mode
- Use consistent formatting (2-space indentation)
- Prefer explicit types over `any`

## Pull Requests

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Run tests: `npm test`
4. Push and open a PR

### Commit Messages

Use conventional commits:

```
feat: add session digest support
fix: correct platform fee rounding
docs: update README examples
test: add constraint merge tests
```

## Normative Behavior

Some functions are **normative** — they must produce identical results across all SDK implementations (TypeScript, Python):

- `transformToCanonical()` — Deterministic integer conversion
- `verifyLocally()` — 9-step verification algorithm
- `computePlatformFee()` — Ceiling rounding for fees
- Denial codes — Must match specification

Changes to normative behavior require specification updates first.

## License

MIT

---

*Standard Logic Co. — Building the trust infrastructure for AI agents*
