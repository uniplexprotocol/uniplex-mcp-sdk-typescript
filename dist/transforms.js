"use strict";
/**
 * Uniplex MCP Server - Transforms Module
 * Version: 1.0.0
 *
 * NORMATIVE: Implements deterministic financial value transforms
 * All SDKs MUST produce identical results.
 *
 * Cross-ref: MCP Server Spec Section 2.3
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformToCanonical = transformToCanonical;
exports.dollarsToCents = dollarsToCents;
exports.canTransform = canTransform;
exports.transformSafe = transformSafe;
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
function transformToCanonical(value, precision, mode = 'strict') {
    const str0 = String(value).trim();
    // Validate numeric format (allows optional sign, integer or decimal)
    if (!/^[+-]?\d+(\.\d+)?$/.test(str0)) {
        throw new Error(`Invalid numeric value: ${value}`);
    }
    const isNegative = str0.startsWith('-');
    const str = str0.replace(/^[+-]/, '');
    const [wholeRaw, decRaw = ''] = str.split('.');
    const whole = wholeRaw === '' ? '0' : wholeRaw;
    const dec = decRaw;
    const MAX = BigInt(Number.MAX_SAFE_INTEGER);
    const base = BigInt(10) ** BigInt(precision);
    // Build canonical integer from whole + first N decimal digits (padded with zeros)
    const build = (decDigits) => {
        const padded = decDigits.padEnd(precision, '0').slice(0, precision);
        return BigInt(whole) * base + (padded === '' ? 0n : BigInt(padded));
    };
    let result;
    if (dec.length > precision) {
        if (mode === 'strict') {
            throw new Error(`Value ${value} has ${dec.length} decimal places, max is ${precision}`);
        }
        const truncated = build(dec.slice(0, precision));
        if (mode === 'truncate') {
            result = truncated;
        }
        else {
            // mode === 'round': round half-up (away from zero)
            const nextDigit = Number(dec[precision]); // safe: single digit
            result = nextDigit >= 5 ? truncated + 1n : truncated;
        }
    }
    else {
        result = build(dec);
    }
    if (isNegative)
        result = -result;
    // Overflow check: reject if outside safe integer range (inclusive bounds)
    if (result > MAX || result < -MAX) {
        throw new Error(`Transformed value ${result.toString()} exceeds safe integer range`);
    }
    return Number(result);
}
/**
 * Alias for dollars_to_cents transform
 * Converts dollar values to cents using precision 2
 */
function dollarsToCents(value, mode = 'strict') {
    return transformToCanonical(value, 2, mode);
}
/**
 * Validate that a value can be transformed without error
 */
function canTransform(value, precision, mode = 'strict') {
    try {
        transformToCanonical(value, precision, mode);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Transform value safely, returning null on error instead of throwing
 */
function transformSafe(value, precision, mode = 'strict') {
    try {
        return transformToCanonical(value, precision, mode);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=transforms.js.map