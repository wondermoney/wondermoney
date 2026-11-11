import { describe, expect, it } from 'vitest';

import { evaluateAmountExpression } from '../lib/amount-expression';

/*
 * Amount fields accept a small arithmetic expression so a shared receipt can be
 * typed as "12.40+3.15" instead of reaching for a calculator. The rules are the
 * four operators and parentheses, operands read with the locale's decimal
 * separator, and a result rounded to cents. `null` means "not a usable amount",
 * never a guessed one.
 */

describe('evaluateAmountExpression', () => {
  it('multiplies and divides before it adds and subtracts', () => {
    expect(evaluateAmountExpression('2+3*4', 'en')).toBe(14);
    expect(evaluateAmountExpression('2*3+4', 'en')).toBe(10);
    expect(evaluateAmountExpression('10-2*3', 'en')).toBe(4);
    expect(evaluateAmountExpression('20/4+3', 'en')).toBe(8);
    expect(evaluateAmountExpression('2+3*4-6/3', 'en')).toBe(12);
  });

  it('honours parentheses, including nesting', () => {
    expect(evaluateAmountExpression('(2+3)*4', 'en')).toBe(20);
    expect(evaluateAmountExpression('2*(3+4)/7', 'en')).toBe(2);
    expect(evaluateAmountExpression('((2+3)*(4-1))', 'en')).toBe(15);
  });

  it('reads unary minus and unary plus', () => {
    expect(evaluateAmountExpression('-5+10', 'en')).toBe(5);
    expect(evaluateAmountExpression('-(2+3)', 'en')).toBe(-5);
    expect(evaluateAmountExpression('2*-3', 'en')).toBe(-6);
    expect(evaluateAmountExpression('--5', 'en')).toBe(5);
    expect(evaluateAmountExpression('+5', 'en')).toBe(5);
    expect(evaluateAmountExpression('-12.50', 'en')).toBe(-12.5);
  });

  it('reads each operand with the locale decimal separator', () => {
    expect(evaluateAmountExpression('12.40+3.15', 'en')).toBe(15.55);
    expect(evaluateAmountExpression('12,40+3,15', 'pt-PT')).toBe(15.55);
    expect(evaluateAmountExpression('12,40+3,15', 'es')).toBe(15.55);
    expect(evaluateAmountExpression('1.000+1', 'pt-PT')).toBe(1001);
    expect(evaluateAmountExpression('1.000+1', 'en')).toBe(2);
    expect(evaluateAmountExpression('1.234,56*2', 'pt-PT')).toBe(2469.12);
    expect(evaluateAmountExpression('1,234.56*2', 'en')).toBe(2469.12);
  });

  it('keeps a plain number as it was, in every locale', () => {
    expect(evaluateAmountExpression('12.50', 'en')).toBe(12.5);
    expect(evaluateAmountExpression('12,50', 'pt-PT')).toBe(12.5);
    expect(evaluateAmountExpression('-12,50', 'es')).toBe(-12.5);
    expect(evaluateAmountExpression('1.234,56', 'pt-PT')).toBe(1234.56);
    expect(evaluateAmountExpression('1,234', 'en')).toBe(1234);
    // The helper rounds every result to cents, a plain number included.
    expect(evaluateAmountExpression('1,234', 'pt-PT')).toBe(1.23);
    expect(evaluateAmountExpression('42', 'en')).toBe(42);
  });

  it('ignores surrounding and grouping whitespace', () => {
    expect(evaluateAmountExpression('  2 + 3  ', 'en')).toBe(5);
    expect(evaluateAmountExpression('1 234,56 + 0,44', 'pt-PT')).toBe(1235);
    expect(evaluateAmountExpression('( 2 + 3 ) * 2', 'en')).toBe(10);
  });

  it('rounds the result to cents', () => {
    expect(evaluateAmountExpression('1/3', 'en')).toBe(0.33);
    expect(evaluateAmountExpression('2/3', 'en')).toBe(0.67);
    expect(evaluateAmountExpression('0.1+0.2', 'en')).toBe(0.3);
    expect(evaluateAmountExpression('12.4+3.15', 'en')).toBe(15.55);
    expect(evaluateAmountExpression('10/4', 'en')).toBe(2.5);
    expect(evaluateAmountExpression('1/1000', 'en')).toBe(0);
  });

  it('rejects division by zero', () => {
    expect(evaluateAmountExpression('1/0', 'en')).toBeNull();
    expect(evaluateAmountExpression('1/(2-2)', 'en')).toBeNull();
    expect(evaluateAmountExpression('0/0', 'en')).toBeNull();
  });

  it('rejects unbalanced or empty parentheses', () => {
    expect(evaluateAmountExpression('(2+3', 'en')).toBeNull();
    expect(evaluateAmountExpression('2+3)', 'en')).toBeNull();
    expect(evaluateAmountExpression('()', 'en')).toBeNull();
    expect(evaluateAmountExpression('(2+3))', 'en')).toBeNull();
    expect(evaluateAmountExpression('((2+3)', 'en')).toBeNull();
  });

  it('rejects letters and malformed operators', () => {
    expect(evaluateAmountExpression('abc', 'en')).toBeNull();
    expect(evaluateAmountExpression('12a+3', 'en')).toBeNull();
    expect(evaluateAmountExpression('2+', 'en')).toBeNull();
    expect(evaluateAmountExpression('*3', 'en')).toBeNull();
    expect(evaluateAmountExpression('2 3', 'en')).toBeNull();
    expect(evaluateAmountExpression('1e5', 'en')).toBeNull();
    expect(evaluateAmountExpression('Infinity', 'en')).toBeNull();
  });

  it('lets a sign follow an operator, as in 2+-3 or 2--3', () => {
    expect(evaluateAmountExpression('2+-3', 'en')).toBe(-1);
    expect(evaluateAmountExpression('2--3', 'en')).toBe(5);
    expect(evaluateAmountExpression('2++3', 'en')).toBe(5);
  });

  it('rejects a blank expression', () => {
    expect(evaluateAmountExpression('', 'en')).toBeNull();
    expect(evaluateAmountExpression('   ', 'en')).toBeNull();
  });

  it('limits the input to 64 characters', () => {
    const atLimit = Array.from({ length: 32 }, () => '1').join('+');
    expect(atLimit).toHaveLength(63);
    expect(evaluateAmountExpression(atLimit, 'en')).toBe(32);
    expect(evaluateAmountExpression(`${atLimit}+1`, 'en')).toBeNull();
    expect(evaluateAmountExpression('1'.repeat(65), 'en')).toBeNull();
  });
});
