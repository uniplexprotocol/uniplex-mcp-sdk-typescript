"use strict";
/**
 * Uniplex MCP Server
 * Version: 1.0.0
 *
 * Model Context Protocol server with Uniplex permission gates.
 * Enables AI agents to discover, request, and use permissions through
 * Uniplex-protected tools.
 *
 * Cross-ref: MCP Server Spec v1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolBuilder = exports.defineTool = exports.UniplexMCPServer = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const cache_js_1 = require("./cache.js");
const session_js_1 = require("./session.js");
const verification_js_1 = require("./verification.js");
const wrapper_js_1 = require("./tools/wrapper.js");
const commerce_js_1 = require("./commerce.js");
// =============================================================================
// UNIPLEX MCP SERVER
// =============================================================================
class UniplexMCPServer {
    server;
    config;
    cacheManager;
    sessionManager;
    toolRegistry;
    rateLimiter;
    constructor(config) {
        this.config = config;
        this.cacheManager = new cache_js_1.CacheManager(config);
        this.sessionManager = new session_js_1.SessionManager({
            safe_default: config.safe_default,
            uniplex_api_url: config.uniplex_api_url,
            gate_id: config.gate_id,
            gate_secret: config.gate_secret,
        });
        this.toolRegistry = new wrapper_js_1.ToolRegistry();
        this.rateLimiter = new verification_js_1.InMemoryRateLimiter();
        // Register tools
        this.toolRegistry.registerMany(config.tools);
        // Configure rate limits from tools
        this.configureRateLimits();
        // Create MCP server
        this.server = new index_js_1.Server({ name: 'uniplex-mcp-sdk', version: '1.0.0' }, { capabilities: this.getCapabilities() });
        // Set up handlers
        this.setupHandlers();
    }
    // ==========================================================================
    // CAPABILITIES
    // ==========================================================================
    getCapabilities() {
        return {
            tools: {},
            uniplex: this.getUniplexCapabilities(),
        };
    }
    getUniplexCapabilities() {
        return {
            version: '1.1.0',
            gate_id: this.config.gate_id,
            catalog_discovery: true,
            safe_default: this.config.safe_default.enabled,
            request_templates: true,
        };
    }
    // ==========================================================================
    // HANDLER SETUP
    // ==========================================================================
    setupHandlers() {
        // Standard MCP handlers
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, this.handleListTools.bind(this));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, this.handleCallTool.bind(this));
        // Uniplex-specific handlers (custom methods)
        this.setupUniplexHandlers();
    }
    setupUniplexHandlers() {
        // These would be registered as custom MCP methods
        // For now, we'll handle them via a custom method router
        // uniplex/catalog - Get permission catalog
        // uniplex/request-passport - Request a new passport
        // uniplex/request-approval - Request approval for permissions
        // uniplex/session - Get current session info
    }
    // ==========================================================================
    // LIST TOOLS HANDLER
    // ==========================================================================
    async handleListTools(request) {
        const sessionId = this.extractSessionId(request);
        const session = await this.sessionManager.getOrCreateSession(sessionId, {
            agentId: request.meta?.agentId,
            issuerId: request.meta?.issuerId,
        });
        const sessionWrapper = new session_js_1.SessionWrapper(session);
        const tools = this.toolRegistry.getAll().map(tool => {
            const allowed = sessionWrapper.hasPermission(tool.permission_key);
            const reason = allowed
                ? undefined
                : `Requires ${tool.permission_key} permission`;
            const effectiveConstraints = allowed
                ? sessionWrapper.getConstraints(tool.permission_key)
                : undefined;
            return (0, wrapper_js_1.toMCPToolFormat)(tool, allowed, reason, effectiveConstraints);
        });
        return { tools };
    }
    // ==========================================================================
    // CALL TOOL HANDLER (HOT PATH)
    // ==========================================================================
    async handleCallTool(request) {
        const sessionId = this.extractSessionId(request);
        const session = await this.sessionManager.getOrCreateSession(sessionId);
        const sessionWrapper = new session_js_1.SessionWrapper(session);
        const toolName = request.params?.name;
        const input = request.params?.arguments ?? {};
        // Find tool
        const tool = this.toolRegistry.get(toolName);
        if (!tool) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            };
        }
        // Build request context from input
        const context = (0, wrapper_js_1.buildRequestContext)(tool, input);
        // Get cached data for verification
        const catalog = this.cacheManager.catalog;
        if (!catalog) {
            return {
                isError: true,
                content: [{ type: 'text', text: 'Catalog not loaded. Please try again.' }],
            };
        }
        // LOCAL verification (MUST NOT call network - Section 1.3)
        const verification = (0, verification_js_1.verifyLocally)({
            passport: sessionWrapper.passport,
            catalog,
            revocationList: this.cacheManager.revocationList,
            issuerKeys: this.cacheManager.issuerKeys,
            rateLimiter: this.rateLimiter,
            action: tool.permission_key,
            context,
        });
        // Handle denial
        if (!verification.allowed) {
            return this.formatDenialResponse(verification, tool);
        }
        // Execute tool
        const auditId = await this.logExecution(tool, input, sessionWrapper);
        const startTime = Date.now();
        try {
            const result = await tool.handler(input);
            const duration_ms = Date.now() - startTime;
            await this.completeAuditLog(auditId, 'success');
            // Create attestations
            const verificationAttestation = this.config.audit?.enabled
                ? await this.createAttestation(tool, sessionWrapper, verification)
                : undefined;
            const consumptionAttestation = this.config.commerce?.enabled && this.config.commerce?.issue_receipts
                ? await this.createConsumptionAttestation(tool, sessionWrapper, verification, duration_ms)
                : undefined;
            return {
                isError: false,
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                _meta: {
                    uniplex_attestation: verificationAttestation,
                    uniplex_consumption: consumptionAttestation,
                },
            };
        }
        catch (error) {
            await this.completeAuditLog(auditId, 'error', error);
            throw error;
        }
    }
    // ==========================================================================
    // DENIAL RESPONSE
    // ==========================================================================
    async formatDenialResponse(verification, tool) {
        // Fetch suggestions (UX enhancement only)
        // MUST NOT delay the deny response - use timeout race
        const suggestions = await Promise.race([
            this.fetchSuggestions(verification, tool),
            new Promise(resolve => setTimeout(() => resolve(null), 500)),
        ]);
        return {
            isError: true,
            content: [
                { type: 'text', text: (0, wrapper_js_1.formatPermissionDenied)(verification, suggestions) },
            ],
            _meta: {
                uniplex_denial: verification.denial,
                uniplex_suggestions: suggestions,
            },
        };
    }
    async fetchSuggestions(verification, tool) {
        // This would fetch from the API, but we keep it simple for now
        const suggestions = {};
        if (verification.denial?.upgrade_template) {
            suggestions.templates = [verification.denial.upgrade_template];
        }
        // Find alternative tools with similar permissions
        const alternatives = this.toolRegistry.getAll()
            .filter(t => t.name !== tool.name)
            .filter(t => t.risk_level === 'low' || t.risk_level === undefined)
            .slice(0, 3)
            .map(t => t.name);
        if (alternatives.length > 0) {
            suggestions.alternative_tools = alternatives;
        }
        return suggestions;
    }
    // ==========================================================================
    // AUDIT LOGGING
    // ==========================================================================
    async logExecution(tool, input, session) {
        if (!this.config.audit?.enabled) {
            return '';
        }
        const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        // Log to console (would send to webhook in production)
        console.error(JSON.stringify({
            type: 'tool_execution_start',
            audit_id: auditId,
            tool: tool.name,
            permission_key: tool.permission_key,
            passport_id: session.passportId,
            session_id: session.sessionId,
            timestamp: new Date().toISOString(),
            ...(this.config.audit.log_inputs && { input }),
        }));
        return auditId;
    }
    async completeAuditLog(auditId, status, error) {
        if (!this.config.audit?.enabled || !auditId) {
            return;
        }
        console.error(JSON.stringify({
            type: 'tool_execution_complete',
            audit_id: auditId,
            status,
            timestamp: new Date().toISOString(),
            ...(error ? { error: String(error) } : {}),
        }));
    }
    // ==========================================================================
    // ATTESTATIONS
    // ==========================================================================
    async createAttestation(tool, session, verification) {
        if (!session.passportId)
            return undefined;
        const attestation = {
            attestation_id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            gate_id: this.config.gate_id,
            passport_id: session.passportId,
            action: tool.permission_key,
            result: 'allowed',
            context: verification.effective_constraints ?? {},
            timestamp: new Date().toISOString(),
        };
        // Canonical JSON (per Section 0.2 Attestation Integrity Invariant)
        const attestation_json = JSON.stringify(attestation);
        // In production, this would be signed with the gate's signing key
        const signature = 'mock_signature_' + attestation.attestation_id;
        return {
            attestation_id: attestation.attestation_id,
            attestation_json,
            signature,
        };
    }
    /**
     * Create a consumption attestation (receipt) for commerce tracking
     * Cross-ref: Patent #27, Commerce Integration Plan Section 2.4
     */
    async createConsumptionAttestation(tool, session, verification, duration_ms) {
        if (!session.passportId || !session.agentId)
            return undefined;
        const signing_key_id = this.config.signing_key_id ?? `${this.config.gate_id}#key-1`;
        // Mock signing function - in production, use actual cryptographic signing
        const mockSign = async (payload) => {
            return 'mock_sig_' + Buffer.from(payload).toString('base64').slice(0, 20);
        };
        try {
            const attestation = await (0, commerce_js_1.issueConsumptionAttestation)({
                gate_id: this.config.gate_id,
                agent_id: session.agentId,
                passport_id: session.passportId,
                permission_key: tool.permission_key,
                catalog_version: this.cacheManager.getCatalogVersion() ?? 1,
                effective_constraints: verification.effective_constraints ?? {},
                duration_ms,
                sign: mockSign,
                signing_key_id,
            });
            return attestation;
        }
        catch (error) {
            console.error('Failed to create consumption attestation:', error);
            return undefined;
        }
    }
    // ==========================================================================
    // RATE LIMIT CONFIGURATION
    // ==========================================================================
    configureRateLimits() {
        for (const tool of this.config.tools) {
            // Check for rate limit constraints in catalog or tool config
            const rateLimit = tool.constraints?.find(c => c.key === 'core:rate:max_per_minute' || c.key === 'core:rate:max_per_hour');
            if (rateLimit && rateLimit.fixed_value) {
                const windowMs = rateLimit.key === 'core:rate:max_per_minute'
                    ? 60000
                    : 3600000;
                this.rateLimiter.setLimit(tool.permission_key, Number(rateLimit.fixed_value), windowMs);
            }
        }
    }
    // ==========================================================================
    // HELPER METHODS
    // ==========================================================================
    extractSessionId(request) {
        return request.meta?.sessionId ?? request._meta?.sessionId ?? 'default';
    }
    // ==========================================================================
    // CUSTOM MCP METHODS (Uniplex Extensions)
    // ==========================================================================
    /**
     * Handle uniplex/catalog request
     * Returns the permission catalog for this gate
     */
    async handleCatalog() {
        const catalog = this.cacheManager.catalog;
        if (!catalog) {
            throw new Error('Catalog not loaded');
        }
        return {
            gate_id: catalog.gate_id,
            version: catalog.current.version,
            permissions: Object.values(catalog.permissionsByKey).map(p => ({
                permission_key: p.permission_key,
                display_name: p.display_name,
                description: p.description,
                risk_level: p.risk_level,
                required_constraints: p.required_constraints,
            })),
        };
    }
    /**
     * Handle uniplex/session request
     * Returns current session information
     */
    async handleSession(request) {
        const sessionId = this.extractSessionId(request);
        const session = await this.sessionManager.getOrCreateSession(sessionId);
        const wrapper = new session_js_1.SessionWrapper(session);
        return {
            session_id: sessionId,
            passport_id: wrapper.passportId,
            permissions: wrapper.getPermissions(),
            constraints: wrapper.getConstraints(),
            expires_at: wrapper.expiresAt,
        };
    }
    /**
     * Handle uniplex/request-passport
     * Requests a new passport with specified permissions
     */
    async handleRequestPassport(request) {
        // This would call the Uniplex API to request a passport
        // For now, return a placeholder
        return {
            status: 'pending',
            request_id: `req_${Date.now()}`,
            permissions_requested: request.params?.permissions ?? [],
        };
    }
    /**
     * Handle uniplex/request-approval
     * Requests human approval for elevated permissions
     */
    async handleRequestApproval(request) {
        return {
            status: 'pending',
            approval_id: `appr_${Date.now()}`,
            permissions_requested: request.params?.permissions ?? [],
            approval_url: `https://uniplex.ai/approve/${this.config.gate_id}/${Date.now()}`,
        };
    }
    // ==========================================================================
    // SERVER LIFECYCLE
    // ==========================================================================
    async initialize() {
        // Start background cache refresh
        await this.cacheManager.startBackgroundRefresh();
        console.error('Uniplex MCP Server initialized');
    }
    async run() {
        await this.initialize();
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('Uniplex MCP Server running on stdio');
    }
    async stop() {
        this.cacheManager.stopBackgroundRefresh();
        await this.server.close();
        console.error('Uniplex MCP Server stopped');
    }
    // ==========================================================================
    // TEST MODE
    // ==========================================================================
    /**
     * Set up test session with mock passport
     */
    async setTestSession(config) {
        const sessionId = config.sessionId ?? 'test';
        const session = await this.sessionManager.getOrCreateSession(sessionId);
        // Create mock passport
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const mockPassport = {
            passport_id: `passport_test_${sessionId}`,
            issuer_id: 'issuer_test',
            agent_id: `agent_test_${sessionId}`,
            gate_id: this.config.gate_id,
            permissions: config.permissions.map(key => ({
                permission_key: key,
                constraints: config.constraints ?? {},
            })),
            constraints: config.constraints ?? {},
            signature: '0'.repeat(128),
            expires_at: expiresAt.toISOString(),
            issued_at: now.toISOString(),
        };
        // Add to issuer keys for test
        this.cacheManager.updateIssuerKeys({
            ...this.cacheManager.issuerKeys,
            'issuer_test': '0'.repeat(64), // Mock public key
        });
        this.sessionManager.setPassport(sessionId, mockPassport);
    }
    /**
     * Direct tool call for testing
     */
    async callTool(params) {
        return this.handleCallTool({
            params,
            meta: { sessionId: 'test' },
        });
    }
}
exports.UniplexMCPServer = UniplexMCPServer;
var wrapper_js_2 = require("./tools/wrapper.js");
Object.defineProperty(exports, "defineTool", { enumerable: true, get: function () { return wrapper_js_2.defineTool; } });
Object.defineProperty(exports, "ToolBuilder", { enumerable: true, get: function () { return wrapper_js_2.ToolBuilder; } });
//# sourceMappingURL=server.js.map