/**
 * Uniplex MCP Server - Tool Wrapper Module
 * Version: 1.0.0
 * 
 * Wraps tool execution with permission verification.
 * Implements buildRequestContext and executeToolWithPermissions.
 * 
 * Cross-ref: MCP Server Spec Section 3.1 (Pre-Execution Check)
 */

import { JSONPath } from 'jsonpath-plus';
import {
  ToolDefinition,
  ConstraintMapping,
  RequestContext,
  VerifyResult,
  TransformMode,
  ConsumptionAttestation,
} from '../types.js';
import { transformToCanonical } from '../transforms.js';

// =============================================================================
// REQUEST CONTEXT BUILDER
// =============================================================================

/**
 * Build request context from tool input for constraint validation
 * 
 * Extracts constraint values from input using JSON path and transforms
 * 
 * Cross-ref: Section 3.1 buildRequestContext
 */
export function buildRequestContext(
  tool: ToolDefinition,
  input: Record<string, unknown>
): RequestContext {
  const context: RequestContext = {};
  
  if (!tool.constraints) {
    return context;
  }
  
  for (const constraint of tool.constraints) {
    try {
      const value = extractConstraintValue(constraint, input);
      if (value !== undefined) {
        const transformed = applyTransform(value, constraint);
        context[constraint.key] = transformed;
        
        // Also set with canonical suffix for amount fields
        if (constraint.key.includes('cost') || constraint.key.includes('price')) {
          context['amount_canonical'] = transformed;
        }
      }
    } catch (error) {
      console.error(`Failed to extract constraint ${constraint.key}:`, error);
      // Continue with other constraints
    }
  }
  
  return context;
}

/**
 * Extract raw value from input based on constraint mapping
 */
function extractConstraintValue(
  constraint: ConstraintMapping,
  input: Record<string, unknown>
): unknown {
  if (constraint.source === 'fixed') {
    return constraint.fixed_value;
  }
  
  if (constraint.source === 'input' && constraint.input_path) {
    // Use JSONPath to extract value
    const results = JSONPath({ path: constraint.input_path, json: input });
    return results.length > 0 ? results[0] : undefined;
  }
  
  return undefined;
}

/**
 * Apply transform to extracted value
 * 
 * CRITICAL: Uses string-based transform to avoid float precision issues
 */
function applyTransform(
  value: unknown,
  constraint: ConstraintMapping
): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  
  const transform = constraint.transform ?? 'none';
  const mode: TransformMode = constraint.transform_mode ?? 'strict';
  
  switch (transform) {
    case 'none':
      return value;
      
    case 'dollars_to_cents':
      // Alias for transformToCanonical(value, 2, mode)
      return transformToCanonical(String(value), 2, mode);
      
    case 'custom':
      // Use precision field directly
      const precision = constraint.precision ?? 2;
      return transformToCanonical(String(value), precision, mode);
      
    default:
      return value;
  }
}

// =============================================================================
// DENIAL RESPONSE FORMATTING
// =============================================================================

export interface DenialSuggestions {
  templates?: string[];
  alternative_tools?: string[];
  upgrade_url?: string;
}

/**
 * Format permission denial into user-friendly message
 */
export function formatPermissionDenied(
  verification: VerifyResult,
  suggestions?: DenialSuggestions | null
): string {
  const denial = verification.denial;
  if (!denial) {
    return 'Permission denied';
  }
  
  let message = denial.message;
  
  // Add upgrade hint if available
  if (denial.upgrade_template) {
    message += `\n\nYou can request the "${denial.upgrade_template}" permission template to gain access.`;
  }
  
  // Add suggestions if available
  if (suggestions?.templates?.length) {
    message += `\n\nAvailable templates: ${suggestions.templates.join(', ')}`;
  }
  
  if (suggestions?.alternative_tools?.length) {
    message += `\n\nAlternative tools you can use: ${suggestions.alternative_tools.join(', ')}`;
  }
  
  if (suggestions?.upgrade_url) {
    message += `\n\nRequest access at: ${suggestions.upgrade_url}`;
  }
  
  return message;
}

// =============================================================================
// TOOL EXECUTION RESULT
// =============================================================================

export interface ToolExecutionResult {
  isError: boolean;
  content: Array<{ type: string; text: string }>;
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

// =============================================================================
// TOOL REGISTRY
// =============================================================================

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }
  
  registerMany(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }
  
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
  
  has(name: string): boolean {
    return this.tools.has(name);
  }
  
  remove(name: string): boolean {
    return this.tools.delete(name);
  }
  
  clear(): void {
    this.tools.clear();
  }
}

// =============================================================================
// TOOL DEFINITION BUILDER
// =============================================================================

/**
 * Fluent builder for tool definitions
 */
export class ToolBuilder {
  private tool: Partial<ToolDefinition> = {};
  
  name(name: string): this {
    this.tool.name = name;
    return this;
  }
  
  description(description: string): this {
    this.tool.description = description;
    return this;
  }
  
  permission(key: string): this {
    this.tool.permission_key = key;
    return this;
  }
  
  risk(level: ToolDefinition['risk_level']): this {
    this.tool.risk_level = level;
    return this;
  }
  
  schema(schema: ToolDefinition['inputSchema']): this {
    this.tool.inputSchema = schema;
    return this;
  }
  
  requireConstraint(key: string): this {
    if (!this.tool.required_constraints) {
      this.tool.required_constraints = [];
    }
    this.tool.required_constraints.push(key);
    return this;
  }
  
  constraint(mapping: ConstraintMapping): this {
    if (!this.tool.constraints) {
      this.tool.constraints = [];
    }
    this.tool.constraints.push(mapping);
    return this;
  }
  
  /**
   * Add a cost constraint that extracts price from input
   */
  costConstraint(inputPath: string, transform: 'dollars_to_cents' | 'custom' = 'dollars_to_cents', precision?: number): this {
    const mapping: ConstraintMapping = {
      key: 'core:cost:max',
      source: 'input',
      input_path: inputPath,
      transform,
      precision: precision ?? 2,
    };
    return this.constraint(mapping).requireConstraint('core:cost:max');
  }
  
  handler(handler: ToolDefinition['handler']): this {
    this.tool.handler = handler;
    return this;
  }
  
  build(): ToolDefinition {
    if (!this.tool.name) throw new Error('Tool name is required');
    if (!this.tool.permission_key) throw new Error('Permission key is required');
    if (!this.tool.handler) throw new Error('Handler is required');
    if (!this.tool.inputSchema) {
      this.tool.inputSchema = { type: 'object', properties: {} };
    }
    
    return this.tool as ToolDefinition;
  }
}

/**
 * Create a tool builder
 */
export function defineTool(): ToolBuilder {
  return new ToolBuilder();
}

// =============================================================================
// MCP TOOL FORMAT CONVERSION
// =============================================================================

/**
 * Convert internal ToolDefinition to MCP tool format for list_tools response
 */
export function toMCPToolFormat(
  tool: ToolDefinition,
  sessionAllowed: boolean,
  reason?: string,
  effectiveConstraints?: Record<string, unknown>
): object {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    uniplex: {
      permission_key: tool.permission_key,
      risk_level: tool.risk_level ?? 'low',
      required_constraints: tool.required_constraints ?? [],
      constraints: tool.constraints?.map((c: ConstraintMapping) => ({
        key: c.key,
        source: c.source,
        input_path: c.input_path,
        transform: c.transform,
        precision: c.precision,
      })),
      session_state: {
        allowed: sessionAllowed,
        reason: sessionAllowed ? undefined : reason,
        upgrade_template: sessionAllowed ? undefined : undefined, // Would come from catalog
        effective_constraints: sessionAllowed ? effectiveConstraints : undefined,
      },
    },
  };
}
