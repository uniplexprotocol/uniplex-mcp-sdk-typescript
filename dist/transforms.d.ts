/**
 * Uniplex MCP Server - Transforms Module
 * Version: 1.0.0
 *
 * NORMATIVE: Implements deterministic financial value transforms
 * All SDKs MUST produce identical results.
 *
 * Cross-ref: MCP Server Spec Section 2.3
 */
import { TransformMode } from './types.js';
/**
 * Transforms a financial value to its canonical integer representation.
 *
 * NORMATIVE:
 * - Implementations MUST be deterministic across SDKs.
 * - Implementations MUST compute using arbitrary precision (BigInt) and
 *   MUST reject if abs(result) > Number.MAX_SAFE_INTEGER before returning.
 *
 * @param value - The input value (string strongly recommended for precision)
 * @param precision - Number of decimal places (e.g., 2 for cents, 8 for satoshis)
 * @param mode - 'strict' (default) | 'truncate' | 'round'
 * @returns Integer in smallest unit (JS number, safe range only)
 * @throws If value exceeds precision in strict mode, or overflows MAX_SAFE_INTEGER
 */
export declare function transformToCanonical(value: number | string, precision: number, mode?: TransformMode): number;
/**
 * Alias for dollars_to_cents transform
 * Converts dollar values to cents using precision 2
 */
export declare function dollarsToCents(value: number | string, mode?: TransformMode): number;
/**
 * Validate that a value can be transformed without error
 */
export declare function canTransform(value: number | string, precision: number, mode?: TransformMode): boolean;
/**
 * Transform value safely, returning null on error instead of throwing
 */
export declare function transformSafe(value: number | string, precision: number, mode?: TransformMode): number | null;
//# sourceMappingURL=transforms.d.ts.map