/**
 * Arithmetic in amount fields: "12.40+3.15" is 15.55, so a shared receipt does
 * not need a trip to the calculator.
 *
 * The grammar is deliberately small — `+ - * /`, parentheses, unary signs and
 * numbers — and every number is read with the locale's decimal separator, the
 * same rules as `@wondermoney/shared/decimal` ("12,40" in pt and es, "12.40" in
 * en; "1.000" is 1000 in pt and 1 in en). A recursive-descent parser walks the
 * tokens; `eval` and `Function` are never used, so the input cannot execute
 * anything.
 *
 * The result is a number rounded to cents. `null` means the text is not a usable
 * amount — a blank field, a letter, an unbalanced parenthesis, a division by
 * zero, or more than 64 characters — and the caller shows its invalid-amount
 * message instead of saving another figure.
 *
 * This module depends only on the locale decimal parser, so web and mobile can
 * import it directly (`@wondermoney/shared/amount-expression`).
 */

import { parseDecimalNumber } from '../decimal';

/** The longest expression an amount field accepts, in characters. */
export const MAX_AMOUNT_EXPRESSION_LENGTH = 64;

type Operator = '+' | '-' | '*' | '/';

type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: Operator }
  | { type: 'paren'; value: '(' | ')' };

const isOperator = (char: string): char is Operator =>
  char === '+' || char === '-' || char === '*' || char === '/';

/** The minus sign a keyboard may send instead of "-". */
const UNICODE_MINUS = '\u2212';

/**
 * Splits the text into numbers and operators. A run of other characters is one
 * operand, so a locale group separator inside it ("1 234,56") stays intact; the
 * decimal parser then decides whether it is a number.
 */
function tokenize(text: string, locale: string): Token[] | null {
  const tokens: Token[] = [];
  let operand = '';

  const flush = (): boolean => {
    const value = operand.trim();
    operand = '';
    if (value === '') return true;
    const number = parseDecimalNumber(value, { locale });
    if (number === null) return false;
    tokens.push({ type: 'number', value: number });
    return true;
  };

  for (const char of text) {
    if (char === '(' || char === ')') {
      if (!flush()) return null;
      tokens.push({ type: 'paren', value: char });
    } else if (isOperator(char) || char === UNICODE_MINUS) {
      if (!flush()) return null;
      tokens.push({
        type: 'operator',
        value: char === UNICODE_MINUS ? '-' : (char as Operator),
      });
    } else {
      operand += char;
    }
  }

  return flush() ? tokens : null;
}

/**
 * Recursive descent over the tokens:
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary)*
 *   unary      := ('+' | '-') unary | primary
 *   primary    := number | '(' expression ')'
 *
 * `null` is a parse error or a division by zero; the caller does not need to
 * tell them apart.
 */
class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number | null {
    const value = this.expression();
    if (value === null || this.index !== this.tokens.length) return null;
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private expression(): number | null {
    let left = this.term();
    if (left === null) return null;
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'operator' || (token.value !== '+' && token.value !== '-')) {
        return left;
      }
      this.index += 1;
      const right = this.term();
      if (right === null) return null;
      left = token.value === '+' ? left + right : left - right;
    }
  }

  private term(): number | null {
    let left = this.unary();
    if (left === null) return null;
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'operator' || (token.value !== '*' && token.value !== '/')) {
        return left;
      }
      this.index += 1;
      const right = this.unary();
      if (right === null) return null;
      if (token.value === '*') {
        left *= right;
      } else {
        if (right === 0) return null;
        left /= right;
      }
    }
  }

  private unary(): number | null {
    const token = this.peek();
    if (token && token.type === 'operator' && (token.value === '+' || token.value === '-')) {
      this.index += 1;
      const value = this.unary();
      if (value === null) return null;
      return token.value === '-' ? -value : value;
    }
    return this.primary();
  }

  private primary(): number | null {
    const token = this.peek();
    if (!token) return null;
    if (token.type === 'number') {
      this.index += 1;
      return token.value;
    }
    if (token.type === 'paren' && token.value === '(') {
      this.index += 1;
      const value = this.expression();
      if (value === null) return null;
      const close = this.peek();
      if (!close || close.type !== 'paren' || close.value !== ')') return null;
      this.index += 1;
      return value;
    }
    return null;
  }
}

/** A number rounded to cents, with `-0` normalised to `0`. */
function roundToCents(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Evaluates an amount expression written in `locale`, or returns `null` when the
 * text is not a usable amount. A plain number is returned unchanged (rounded to
 * cents), so callers can use this for every amount field.
 */
export function evaluateAmountExpression(
  input: string,
  locale: string
): number | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text === '' || text.length > MAX_AMOUNT_EXPRESSION_LENGTH) return null;

  const tokens = tokenize(text, locale);
  if (!tokens || tokens.length === 0) return null;

  const value = new Parser(tokens).parse();
  if (value === null || !Number.isFinite(value)) return null;
  return roundToCents(value);
}
