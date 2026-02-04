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
import { UniplexMCPServerConfig } from './types.js';
import { ToolExecutionResult } from './tools/wrapper.js';
export declare class UniplexMCPServer {
    private server;
    private config;
    private cacheManager;
    private sessionManager;
    private toolRegistry;
    private rateLimiter;
    constructor(config: UniplexMCPServerConfig);
    private getCapabilities;
    private getUniplexCapabilities;
    private setupHandlers;
    private setupUniplexHandlers;
    private handleListTools;
    private handleCallTool;
    private formatDenialResponse;
    private fetchSuggestions;
    private logExecution;
    private completeAuditLog;
    private createAttestation;
    /**
     * Create a consumption attestation (receipt) for commerce tracking
     * Cross-ref: Patent #27, Commerce Integration Plan Section 2.4
     */
    private createConsumptionAttestation;
    private configureRateLimits;
    private extractSessionId;
    /**
     * Handle uniplex/catalog request
     * Returns the permission catalog for this gate
     */
    handleCatalog(): Promise<object>;
    /**
     * Handle uniplex/session request
     * Returns current session information
     */
    handleSession(request: any): Promise<object>;
    /**
     * Handle uniplex/request-passport
     * Requests a new passport with specified permissions
     */
    handleRequestPassport(request: any): Promise<object>;
    /**
     * Handle uniplex/request-approval
     * Requests human approval for elevated permissions
     */
    handleRequestApproval(request: any): Promise<object>;
    initialize(): Promise<void>;
    run(): Promise<void>;
    stop(): Promise<void>;
    /**
     * Set up test session with mock passport
     */
    setTestSession(config: {
        sessionId?: string;
        permissions: string[];
        constraints?: Record<string, unknown>;
    }): Promise<void>;
    /**
     * Direct tool call for testing
     */
    callTool(params: {
        name: string;
        arguments: Record<string, unknown>;
    }): Promise<ToolExecutionResult>;
}
export { UniplexMCPServerConfig, ToolDefinition } from './types.js';
export { defineTool, ToolBuilder } from './tools/wrapper.js';
//# sourceMappingURL=server.d.ts.map