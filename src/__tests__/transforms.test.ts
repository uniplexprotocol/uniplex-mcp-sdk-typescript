/**
 * Uniplex MCP Server - Transform Tests
 * 
 * CONFORMANCE TEST VECTORS from MCP Server Spec Section 2.3
 * SDK implementations MUST pass these test cases exactly.
 */

import { describe, it, expect } from 'vitest';
import { transformToCanonical, dollarsToCents } from '../transforms.js';

describe('transformToCanonical', () => {
  // =========================================================================
  // Test Vectors - Mode: `strict` (DEFAULT)
  // =========================================================================
  
  describe('strict mode (default)', () => {
    it('1.00 with precision 2 → 100', () => {
      expect(transformToCanonical('1.00', 2)).toBe(100);
    });
    
    it('1.005 with precision 2 → REJECT (exceeds precision)', () => {
      expect(() => transformToCanonical('1.005', 2)).toThrow();
    });
    
    it('1.005 with precision 3 → 1005 (within precision)', () => {
      expect(transformToCanonical('1.005', 3)).toBe(1005);
    });
    
    it('4.99 with precision 2 → 499', () => {
      expect(transformToCanonical('4.99', 2)).toBe(499);
    });
    
    it('4.995 with precision 2 → REJECT (exceeds precision)', () => {
      expect(() => transformToCanonical('4.995', 2)).toThrow();
    });
    
    it('0.1 with precision 2 → 10', () => {
      expect(transformToCanonical('0.1', 2)).toBe(10);
    });
    
    it('0.10 with precision 2 → 10 (trailing zero)', () => {
      expect(transformToCanonical('0.10', 2)).toBe(10);
    });
    
    it('0.01 with precision 2 → 1 (single cent)', () => {
      expect(transformToCanonical('0.01', 2)).toBe(1);
    });
    
    it('0.001 with precision 3 → 1 (micropayment)', () => {
      expect(transformToCanonical('0.001', 3)).toBe(1);
    });
    
    it('0.001 with precision 2 → REJECT (exceeds precision)', () => {
      expect(() => transformToCanonical('0.001', 2)).toThrow();
    });
    
    it('-4.99 with precision 2 → -499 (negative/refund)', () => {
      expect(transformToCanonical('-4.99', 2)).toBe(-499);
    });
    
    it('1000000.00 with precision 2 → 100000000 (large but safe)', () => {
      expect(transformToCanonical('1000000.00', 2)).toBe(100000000);
    });
    
    it('90071992547409.91 with precision 2 → 9007199254740991 (exactly MAX_SAFE_INTEGER)', () => {
      expect(transformToCanonical('90071992547409.91', 2)).toBe(9007199254740991);
    });
    
    it('90071992547409.92 with precision 2 → REJECT (exceeds MAX_SAFE_INTEGER)', () => {
      expect(() => transformToCanonical('90071992547409.92', 2)).toThrow();
    });
    
    it('0 with precision 2 → 0', () => {
      expect(transformToCanonical('0', 2)).toBe(0);
    });
    
    it('0.00 with precision 2 → 0 (zero with decimals)', () => {
      expect(transformToCanonical('0.00', 2)).toBe(0);
    });
  });
  
  // =========================================================================
  // Test Vectors - Mode: `round`
  // =========================================================================
  
  describe('round mode', () => {
    it('1.005 with precision 2 → 101 (rounded half-up)', () => {
      expect(transformToCanonical('1.005', 2, 'round')).toBe(101);
    });
    
    it('1.004 with precision 2 → 100 (rounded down)', () => {
      expect(transformToCanonical('1.004', 2, 'round')).toBe(100);
    });
    
    it('4.995 with precision 2 → 500 (rounded half-up)', () => {
      expect(transformToCanonical('4.995', 2, 'round')).toBe(500);
    });
    
    it('4.994 with precision 2 → 499 (rounded down)', () => {
      expect(transformToCanonical('4.994', 2, 'round')).toBe(499);
    });
    
    it('0.001 with precision 2 → 0 (rounded to zero)', () => {
      expect(transformToCanonical('0.001', 2, 'round')).toBe(0);
    });
    
    it('-1.005 with precision 2 → -101 (negative rounded half-up, away from zero)', () => {
      expect(transformToCanonical('-1.005', 2, 'round')).toBe(-101);
    });
  });
  
  // =========================================================================
  // Test Vectors - Mode: `truncate`
  // =========================================================================
  
  describe('truncate mode', () => {
    it('1.005 with precision 2 → 100 (truncated, NOT rounded)', () => {
      expect(transformToCanonical('1.005', 2, 'truncate')).toBe(100);
    });
    
    it('1.009 with precision 2 → 100 (truncated)', () => {
      expect(transformToCanonical('1.009', 2, 'truncate')).toBe(100);
    });
    
    it('4.999 with precision 2 → 499 (truncated)', () => {
      expect(transformToCanonical('4.999', 2, 'truncate')).toBe(499);
    });
  });
  
  // =========================================================================
  // Invalid Input Tests
  // =========================================================================
  
  describe('invalid inputs', () => {
    it('rejects non-numeric string', () => {
      expect(() => transformToCanonical('abc', 2)).toThrow();
    });
    
    it('rejects empty string', () => {
      expect(() => transformToCanonical('', 2)).toThrow();
    });
    
    it('rejects string with spaces', () => {
      expect(() => transformToCanonical('1 000', 2)).toThrow();
    });
    
    it('accepts string with leading/trailing whitespace (trimmed)', () => {
      expect(transformToCanonical('  4.99  ', 2)).toBe(499);
    });
    
    it('accepts positive sign', () => {
      expect(transformToCanonical('+4.99', 2)).toBe(499);
    });
  });
  
  // =========================================================================
  // Number Input Tests (less recommended but supported)
  // =========================================================================
  
  describe('number inputs', () => {
    it('accepts number input (converted to string)', () => {
      expect(transformToCanonical(4.99, 2)).toBe(499);
    });
    
    it('integer input works correctly', () => {
      expect(transformToCanonical(100, 2)).toBe(10000);
    });
  });
  
  // =========================================================================
  // Edge Cases
  // =========================================================================
  
  describe('edge cases', () => {
    it('handles precision 0', () => {
      expect(transformToCanonical('123', 0)).toBe(123);
    });
    
    it('handles high precision (8 for satoshis)', () => {
      expect(transformToCanonical('0.00000001', 8)).toBe(1);
    });
    
    it('handles very small values', () => {
      expect(transformToCanonical('0.00000100', 8)).toBe(100);
    });
    
    it('handles whole numbers', () => {
      expect(transformToCanonical('100', 2)).toBe(10000);
    });
  });
});

// =========================================================================
// dollarsToCents Helper Tests
// =========================================================================

describe('dollarsToCents', () => {
  it('converts 4.99 → 499', () => {
    expect(dollarsToCents('4.99')).toBe(499);
  });
  
  it('converts 100 → 10000', () => {
    expect(dollarsToCents('100')).toBe(10000);
  });
  
  it('rejects 1.005 in strict mode', () => {
    expect(() => dollarsToCents('1.005')).toThrow();
  });
  
  it('rounds 1.005 in round mode', () => {
    expect(dollarsToCents('1.005', 'round')).toBe(101);
  });
});
