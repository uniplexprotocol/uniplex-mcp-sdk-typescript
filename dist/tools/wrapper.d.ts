/**
 * Uniplex MCP Server - Tool Wrapper Module
 * Version: 1.0.0
 *
 * Wraps tool execution with permission verification.
 * Implements buildRequestContext and executeToolWithPermissions.
 *
 * Cross-ref: MCP Server Spec Section 3.1 (Pre-Execution Check)
 */
import { ToolDefinition, ConstraintMapping, RequestContext, VerifyResult, ConsumptionAttestation } from '../types.js';
/**
 * Build request context from tool input for constraint validation
 *
 * Extracts constraint values from input using JSON path and transforms
 *
 * Cross-ref: Section 3.1 buildRequestContext
 */
export declare function buildRequestContext(tool: ToolDefinition, input: Record<string, unknown>): RequestContext;
export interface DenialSuggestions {
    templates?: string[];
    alternative_tools?: string[];
    upgrade_url?: string;
}
/**
 * Format permission denial into user-friendly message
 */
export declare function formatPermissionDenied(verification: VerifyResult, suggestions?: DenialSuggestions | null): string;
export interface ToolExecutionResult {
    isError: boolean;
    content: Array<{
        type: string;
        text: string;
    }>;
    _meta?: {
        uniplex_denial?: VerifyResult['denial'];
        uniplex_suggestions?: DenialSuggestions | null;
        uniplex_attestation?: {
            attestation_id: string;
            attestation_json: string;
            signature: string;
        };
        uniplex_consumption?: ConsumptionAttestation;
    };
}
export declare class ToolRegistry {
    private tools;
    register(tool: ToolDefinition): void;
    registerMany(tools: ToolDefinition[]): void;
    get(name: string): ToolDefinition | undefined;
    getAll(): ToolDefinition[];
    has(name: string): boolean;
    remove(name: string): boolean;
    clear(): void;
}
/**
 * Fluent builder for tool definitions
 */
export declare class ToolBuilder {
    private tool;
    name(name: string): this;
    description(description: string): this;
    permission(key: string): this;
    risk(level: ToolDefinition['risk_level']): this;
    schema(schema: ToolDefinition['inputSchema']): this;
    requireConstraint(key: string): this;
    constraint(mapping: ConstraintMapping): this;
    /**
     * Add a cost constraint that extracts price from input
     */
    costConstraint(inputPath: string, transform?: 'dollars_to_cents' | 'custom', precision?: number): this;
    handler(handler: ToolDefinition['handler']): this;
    build(): ToolDefinition;
}
/**
 * Create a tool builder
 */
export declare function defineTool(): ToolBuilder;
/**
 * Convert internal ToolDefinition to MCP tool format for list_tools response
 */
export declare function toMCPToolFormat(tool: ToolDefinition, sessionAllowed: boolean, reason?: string, effectiveConstraints?: Record<string, unknown>): object;
//# sourceMappingURL=wrapper.d.ts.map