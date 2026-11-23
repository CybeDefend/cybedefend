import { LicenseCategory, getLicenseInfo } from './license.utils';

export type SpdxNode =
  | { type: 'license'; id: string }
  | { type: 'or'; left: SpdxNode; right: SpdxNode }
  | { type: 'and'; left: SpdxNode; right: SpdxNode }
  | { type: 'with'; license: string; exception: string };

const RISK_ORDER: LicenseCategory[] = [
  LicenseCategory.PERMISSIVE,
  LicenseCategory.WEAK_COPYLEFT,
  LicenseCategory.STRONG_COPYLEFT,
  LicenseCategory.UNKNOWN,
];

interface Token {
  type: 'LPAREN' | 'RPAREN' | 'OR' | 'AND' | 'WITH' | 'ID';
  value: string;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const src = expression.trim();

  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }

    if (src[i] === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (src[i] === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    // Read a word (identifier or keyword)
    let word = '';
    while (i < src.length && /[^\s()]+/.test(src[i])) {
      word += src[i];
      i++;
    }

    const upper = word.toUpperCase();
    if (upper === 'OR') {
      tokens.push({ type: 'OR', value: word });
    } else if (upper === 'AND') {
      tokens.push({ type: 'AND', value: word });
    } else if (upper === 'WITH') {
      tokens.push({ type: 'WITH', value: word });
    } else {
      tokens.push({ type: 'ID', value: word });
    }
  }

  return tokens;
}

/**
 * Recursive descent parser for SPDX expressions.
 * Precedence (lowest to highest): OR < AND < WITH
 */
function parseOrExpr(tokens: Token[], pos: { i: number }): SpdxNode {
  let left = parseAndExpr(tokens, pos);

  while (pos.i < tokens.length && tokens[pos.i].type === 'OR') {
    pos.i++;
    const right = parseAndExpr(tokens, pos);
    left = { type: 'or', left, right };
  }

  return left;
}

function parseAndExpr(tokens: Token[], pos: { i: number }): SpdxNode {
  let left = parseWithExpr(tokens, pos);

  while (pos.i < tokens.length && tokens[pos.i].type === 'AND') {
    pos.i++;
    const right = parseWithExpr(tokens, pos);
    left = { type: 'and', left, right };
  }

  return left;
}

function parseWithExpr(tokens: Token[], pos: { i: number }): SpdxNode {
  const node = parsePrimary(tokens, pos);

  if (
    pos.i < tokens.length &&
    tokens[pos.i].type === 'WITH' &&
    node.type === 'license'
  ) {
    pos.i++;
    if (pos.i >= tokens.length || tokens[pos.i].type !== 'ID') {
      throw new Error('Expected exception identifier after WITH');
    }
    const exception = tokens[pos.i].value;
    pos.i++;
    return { type: 'with', license: node.id, exception };
  }

  return node;
}

function parsePrimary(tokens: Token[], pos: { i: number }): SpdxNode {
  if (pos.i >= tokens.length) {
    throw new Error('Unexpected end of expression');
  }

  const token = tokens[pos.i];

  if (token.type === 'LPAREN') {
    pos.i++;
    const node = parseOrExpr(tokens, pos);
    if (pos.i >= tokens.length || tokens[pos.i].type !== 'RPAREN') {
      throw new Error('Expected closing parenthesis');
    }
    pos.i++;
    return node;
  }

  if (token.type === 'ID') {
    pos.i++;
    return { type: 'license', id: token.value };
  }

  throw new Error(`Unexpected token: ${token.value}`);
}

export function parseSpdxExpression(expression: string): SpdxNode {
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new Error('Empty SPDX expression');
  }
  const pos = { i: 0 };
  const ast = parseOrExpr(tokens, pos);
  if (pos.i < tokens.length) {
    throw new Error(`Unexpected token: ${tokens[pos.i].value}`);
  }
  return ast;
}

function compareRisk(a: LicenseCategory, b: LicenseCategory): number {
  return RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b);
}

function evaluateNode(
  node: SpdxNode,
  overrides?: Map<string, LicenseCategory>,
): LicenseCategory {
  switch (node.type) {
    case 'license':
      return getLicenseInfo(node.id, overrides).category;

    case 'or': {
      const leftRisk = evaluateNode(node.left, overrides);
      const rightRisk = evaluateNode(node.right, overrides);
      return compareRisk(leftRisk, rightRisk) <= 0 ? leftRisk : rightRisk;
    }

    case 'and': {
      const leftRisk = evaluateNode(node.left, overrides);
      const rightRisk = evaluateNode(node.right, overrides);
      return compareRisk(leftRisk, rightRisk) >= 0 ? leftRisk : rightRisk;
    }

    case 'with':
      return getLicenseInfo(node.license, overrides).category;
  }
}

export function getRiskFromExpression(
  expression: string,
  overrides?: Map<string, LicenseCategory>,
): LicenseCategory {
  const ast = parseSpdxExpression(expression);
  return evaluateNode(ast, overrides);
}

/**
 * Collect all license IDs from the "effective" branch of an SPDX expression.
 * For OR: picks the least-risky side (the one the user would choose).
 * For AND: includes both sides (both apply).
 */
function collectEffectiveLicenses(
  node: SpdxNode,
  overrides?: Map<string, LicenseCategory>,
): string[] {
  switch (node.type) {
    case 'license':
      return [node.id];

    case 'or': {
      const leftRisk = evaluateNode(node.left, overrides);
      const rightRisk = evaluateNode(node.right, overrides);
      // Pick the least risky side
      if (compareRisk(leftRisk, rightRisk) <= 0) {
        return collectEffectiveLicenses(node.left, overrides);
      }
      return collectEffectiveLicenses(node.right, overrides);
    }

    case 'and': {
      return [
        ...collectEffectiveLicenses(node.left, overrides),
        ...collectEffectiveLicenses(node.right, overrides),
      ];
    }

    case 'with':
      return [node.license];
  }
}

/**
 * Returns the set of license IDs that a package effectively uses,
 * given its SPDX expression. For OR, only the most permissive branch
 * is selected. For AND, all licenses are included.
 */
export function getEffectiveLicenses(
  expression: string,
  overrides?: Map<string, LicenseCategory>,
): Set<string> {
  try {
    const ast = parseSpdxExpression(expression);
    return new Set(collectEffectiveLicenses(ast, overrides));
  } catch {
    return new Set();
  }
}
