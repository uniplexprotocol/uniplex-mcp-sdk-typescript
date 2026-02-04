"use strict";
/**
 * Uniplex MCP Server - Tool Wrapper Module
 * Version: 1.0.0
 *
 * Wraps tool execution with permission verification.
 * Implements buildRequestContext and executeToolWithPermissions.
 *
 * Cross-ref: MCP Server Spec Section 3.1 (Pre-Execution Check)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolBuilder = exports.ToolRegistry = void 0;
exports.buildRequestContext = buildRequestContext;
exports.formatPermissionDenied = formatPermissionDenied;
exports.defineTool = defineTool;
exports.toMCPToolFormat = toMCPToolFormat;
const jsonpath_plus_1 = require("jsonpath-plus");
const transforms_js_1 = require("../transforms.js");
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
function buildRequestContext(tool, input) {
    const context = {};
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
        }
        catch (error) {
            console.error(`Failed to extract constraint ${constraint.key}:`, error);
            // Continue with other constraints
        }
    }
    return context;
}
/**
 * Extract raw value from input based on constraint mapping
 */
function extractConstraintValue(constraint, input) {
    if (constraint.source === 'fixed') {
        return constraint.fixed_value;
    }
    if (constraint.source === 'input' && constraint.input_path) {
        // Use JSONPath to extract value
        const results = (0, jsonpath_plus_1.JSONPath)({ path: constraint.input_path, json: input });
        return results.length > 0 ? results[0] : undefined;
    }
    return undefined;
}
/**
 * Apply transform to extracted value
 *
 * CRITICAL: Uses string-based transform to avoid float precision issues
 */
function applyTransform(value, constraint) {
    if (value === undefined || value === null) {
        return value;
    }
    const transform = constraint.transform ?? 'none';
    const mode = constraint.transform_mode ?? 'strict';
    switch (transform) {
        case 'none':
            return value;
        case 'dollars_to_cents':
            // Alias for transformToCanonical(value, 2, mode)
            return (0, transforms_js_1.transformToCanonical)(String(value), 2, mode);
        case 'custom':
            // Use precision field directly
            const precision = constraint.precision ?? 2;
            return (0, transforms_js_1.transformToCanonical)(String(value), precision, mode);
        default:
            return value;
    }
}
/**
 * Format permission denial into user-friendly message
 */
function formatPermissionDenied(verification, suggestions) {
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
// TOOL REGISTRY
// =============================================================================
class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    registerMany(tools) {
        for (const tool of tools) {
            this.register(tool);
        }
    }
    get(name) {
        return this.tools.get(name);
    }
    getAll() {
        return Array.from(this.tools.values());
    }
    has(name) {
        return this.tools.has(name);
    }
    remove(name) {
        return this.tools.delete(name);
    }
    clear() {
        this.tools.clear();
    }
}
exports.ToolRegistry = ToolRegistry;
// =============================================================================
// TOOL DEFINITION BUILDER
// =============================================================================
/**
 * Fluent builder for tool definitions
 */
class ToolBuilder {
    tool = {};
    name(name) {
        this.tool.name = name;
        return this;
    }
    description(description) {
        this.tool.description = description;
        return this;
    }
    permission(key) {
        this.tool.permission_key = key;
        return this;
    }
    risk(level) {
        this.tool.risk_level = level;
        return this;
    }
    schema(schema) {
        this.tool.inputSchema = schema;
        return this;
    }
    requireConstraint(key) {
        if (!this.tool.required_constraints) {
            this.tool.required_constraints = [];
        }
        this.tool.required_constraints.push(key);
        return this;
    }
    constraint(mapping) {
        if (!this.tool.constraints) {
            this.tool.constraints = [];
        }
        this.tool.constraints.push(mapping);
        return this;
    }
    /**
     * Add a cost constraint that extracts price from input
     */
    costConstraint(inputPath, transform = 'dollars_to_cents', precision) {
        const mapping = {
            key: 'core:cost:max',
            source: 'input',
            input_path: inputPath,
            transform,
            precision: precision ?? 2,
        };
        return this.constraint(mapping).requireConstraint('core:cost:max');
    }
    handler(handler) {
        this.tool.handler = handler;
        return this;
    }
    build() {
        if (!this.tool.name)
            throw new Error('Tool name is required');
        if (!this.tool.permission_key)
            throw new Error('Permission key is required');
        if (!this.tool.handler)
            throw new Error('Handler is required');
        if (!this.tool.inputSchema) {
            this.tool.inputSchema = { type: 'object', properties: {} };
        }
        return this.tool;
    }
}
exports.ToolBuilder = ToolBuilder;
/**
 * Create a tool builder
 */
function defineTool() {
    return new ToolBuilder();
}
// =============================================================================
// MCP TOOL FORMAT CONVERSION
// =============================================================================
/**
 * Convert internal ToolDefinition to MCP tool format for list_tools response
 */
function toMCPToolFormat(tool, sessionAllowed, reason, effectiveConstraints) {
    return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        uniplex: {
            permission_key: tool.permission_key,
            risk_level: tool.risk_level ?? 'low',
            required_constraints: tool.required_constraints ?? [],
            constraints: tool.constraints?.map((c) => ({
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
//# sourceMappingURL=wrapper.js.map