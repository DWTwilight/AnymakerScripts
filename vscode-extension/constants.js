'use strict';

const { tokenize } = require('./checker');

const BUILTINS = new Set([
  'abs', 'floor', 'ceil', 'round', 'sqrt', 'exp', 'ln', 'log2', 'sin', 'cos',
  'tan', 'asin', 'acos', 'atan', 'rand', 'len', 'to_integer', 'to_fractional',
]);

const isNumeric = (t) => t === 'integer' || t === 'fractional';

function int32(value) {
  return value | 0;
}

function fround(value) {
  const result = Math.fround(value);
  return Number.isFinite(result) ? result : null;
}

function roundTiesToEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

class ExprParser {
  constructor(tokens, pos) {
    this.tokens = tokens;
    this.pos = pos;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  next() {
    return this.tokens[this.pos++];
  }

  check(value) {
    const token = this.peek();
    return !!token && token.value === value;
  }

  match(value) {
    if (this.check(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.match('||')) {
      left = { kind: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseComparison();
    while (this.match('&&')) {
      left = { kind: 'binary', op: '&&', left, right: this.parseComparison() };
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAdd();
    while (this.peek() && ['==', '>', '<', '>=', '<=', 'contains'].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parseAdd() };
    }
    return left;
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.check('+') || this.check('-')) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parseMul() };
    }
    return left;
  }

  parseMul() {
    let left = this.parsePow();
    while (this.check('*') || this.check('/') || this.check('%')) {
      const op = this.next().value;
      left = { kind: 'binary', op, left, right: this.parsePow() };
    }
    return left;
  }

  parsePow() {
    let left = this.parseUnary();
    while (this.match('^')) {
      left = { kind: 'binary', op: '^', left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.check('!')) {
      this.next();
      return { kind: 'not', operand: this.parseUnary() };
    }
    if (this.check('-')) {
      this.next();
      const token = this.peek();
      if (token && token.type === 'number') {
        this.next();
        return { kind: 'number', type: numberType(token), value: Number(token.value) };
      }
      return { kind: 'negate', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) return { kind: 'unknown' };

    if (token.type === 'number') {
      this.next();
      return { kind: 'number', type: numberType(token), value: Number(token.value) };
    }
    if (token.type === 'string') {
      this.next();
      return { kind: 'string', value: token.value.slice(1, -1) };
    }
    if (token.value === '(') {
      this.next();
      const expression = this.parseExpression();
      this.match(')');
      return expression;
    }

    if (token.type === 'ident') {
      if (token.value === 'true' || token.value === 'false') {
        this.next();
        return { kind: 'bool', value: token.value === 'true' };
      }
      if (token.value === 'var') {
        this.next();
        const nameToken = this.peek();
        if (!nameToken || nameToken.type !== 'ident') return { kind: 'unknown' };
        this.next();
        if (this.check('.') || this.check('[')) {
          this.skipAccess();
          return { kind: 'unknown' };
        }
        return { kind: 'name', name: nameToken.value };
      }
      if (token.value === 'out') {
        this.next();
        this.skipPath();
        return { kind: 'unknown' };
      }
      if (BUILTINS.has(token.value) && this.peek(1) && this.peek(1).value === '(') {
        const name = token.value;
        this.next();
        this.next();
        const args = [];
        while (this.peek() && !this.check(')')) {
          args.push(this.parseExpression());
          if (!this.match(',')) break;
        }
        this.match(')');
        return { kind: 'call', name, args };
      }
      this.next();
      return { kind: 'unknown' };
    }

    this.next();
    return { kind: 'unknown' };
  }

  skipPath() {
    if (!this.peek() || this.peek().type !== 'ident') return;
    this.next();
    while (this.check('.') && this.peek(1) && this.peek(1).type === 'ident') {
      this.next();
      this.next();
    }
  }

  skipAccess() {
    while (this.check('.') && this.peek(1) && this.peek(1).type === 'ident') {
      this.next();
      this.next();
    }
    if (this.check('[')) {
      let depth = 0;
      while (this.peek()) {
        const token = this.next();
        if (token.value === '[') depth++;
        else if (token.value === ']') {
          depth--;
          if (depth === 0) break;
        }
      }
    }
  }
}

function numberType(token) {
  return token.value.includes('.') ? 'fractional' : 'integer';
}

function evaluateBinary(op, left, right) {
  if (!left || !right) return null;

  if (op === '&&' || op === '||') {
    if (left.type !== 'bool' || right.type !== 'bool') return null;
    return { type: 'bool', value: op === '&&' ? left.value && right.value : left.value || right.value };
  }
  if (op === '==') {
    if (left.type !== right.type) return null;
    return { type: 'bool', value: left.value === right.value };
  }
  if (op === '>' || op === '<' || op === '>=' || op === '<=') {
    if (left.type !== right.type || (!isNumeric(left.type) && left.type !== 'string')) return null;
    if (op === '>') return { type: 'bool', value: left.value > right.value };
    if (op === '<') return { type: 'bool', value: left.value < right.value };
    if (op === '>=') return { type: 'bool', value: left.value >= right.value };
    return { type: 'bool', value: left.value <= right.value };
  }
  if (op === 'contains') return null;

  if (!isNumeric(left.type) || !isNumeric(right.type)) return null;
  if (left.type !== right.type) return null;

  if (left.type === 'integer') {
    const a = left.value;
    const b = right.value;
    let value;
    switch (op) {
      case '+':
        value = int32(a + b);
        break;
      case '-':
        value = int32(a - b);
        break;
      case '*':
        value = int32(Math.imul(a, b));
        break;
      case '/':
        value = b === 0 ? 0 : int32(Math.trunc(a / b));
        break;
      case '%':
        value = b === 0 ? 0 : int32(a % b);
        break;
      case '^':
        value = int32(Math.pow(a, b));
        break;
      default:
        return null;
    }
    return { type: 'integer', value };
  }

  const a = left.value;
  const b = right.value;
  let value;
  switch (op) {
    case '+':
      value = fround(a + b);
      break;
    case '-':
      value = fround(a - b);
      break;
    case '*':
      value = fround(a * b);
      break;
    case '/':
      value = b === 0 ? 0 : fround(a / b);
      break;
    case '%':
      value = b === 0 ? 0 : fround(a % b);
      break;
    case '^':
      value = fround(Math.pow(a, b));
      break;
    default:
      return null;
  }
  return value === null ? null : { type: 'fractional', value };
}

function numericArg(args, index) {
  const arg = args[index];
  if (!arg || !isNumeric(arg.type)) return null;
  return arg;
}

function evaluateCall(name, args) {
  if (name === 'rand') return null;

  if (name === 'len') {
    const arg = args[0];
    if (args.length !== 1 || !arg || arg.type !== 'string') return null;
    return { type: 'integer', value: arg.value.length };
  }

  if (name === 'to_integer') {
    const arg = numericArg(args, 0);
    if (args.length !== 1 || !arg) return null;
    return { type: 'integer', value: int32(roundTiesToEven(arg.value)) };
  }

  if (name === 'to_fractional') {
    const arg = numericArg(args, 0);
    if (args.length !== 1 || !arg) return null;
    const value = fround(arg.value);
    return value === null ? null : { type: 'fractional', value };
  }

  if (['sin', 'cos', 'tan', 'asin', 'acos', 'atan'].includes(name)) {
    const arg = numericArg(args, 0);
    if (args.length !== 1 || !arg) return null;
    const fn = Math[name];
    const value = fround(fn(arg.value));
    return value === null ? null : { type: 'fractional', value };
  }

  if (['exp', 'ln', 'log2'].includes(name)) {
    const arg = numericArg(args, 0);
    if (args.length !== 1 || !arg) return null;
    const fn = name === 'log2' ? Math.log2 : Math[name];
    const value = fround(fn(arg.value));
    return value === null ? null : { type: 'fractional', value };
  }

  const arg = numericArg(args, 0);
  if (args.length !== 1 || !arg) return null;
  const isInteger = arg.type === 'integer';
  let value;
  switch (name) {
    case 'abs':
      value = Math.abs(arg.value);
      break;
    case 'floor':
      value = Math.floor(arg.value);
      break;
    case 'ceil':
      value = Math.ceil(arg.value);
      break;
    case 'round':
      value = Math.round(arg.value);
      break;
    case 'sqrt':
      value = Math.sqrt(arg.value);
      break;
    default:
      return null;
  }
  if (!Number.isFinite(value)) return null;
  if (isInteger) return { type: 'integer', value: int32(Math.trunc(value)) };
  const rounded = fround(value);
  return rounded === null ? null : { type: 'fractional', value: rounded };
}

function evaluateNode(node, resolve) {
  switch (node.kind) {
    case 'number':
      return { type: node.type, value: node.value };
    case 'bool':
      return { type: 'bool', value: node.value };
    case 'string':
      return { type: 'string', value: node.value };
    case 'name':
      return resolve(node.name);
    case 'not': {
      const operand = evaluateNode(node.operand, resolve);
      if (!operand || operand.type !== 'bool') return null;
      return { type: 'bool', value: !operand.value };
    }
    case 'negate': {
      const operand = evaluateNode(node.operand, resolve);
      if (!operand || !isNumeric(operand.type)) return null;
      if (operand.type === 'integer') return { type: 'integer', value: int32(-operand.value) };
      const value = fround(-operand.value);
      return value === null ? null : { type: 'fractional', value };
    }
    case 'binary': {
      const left = evaluateNode(node.left, resolve);
      const right = evaluateNode(node.right, resolve);
      return evaluateBinary(node.op, left, right);
    }
    case 'call': {
      const args = node.args.map((arg) => evaluateNode(arg, resolve));
      return evaluateCall(node.name, args);
    }
    default:
      return null;
  }
}

function formatValue(value) {
  if (!value) return null;
  if (value.type === 'bool') return value.value ? 'true' : 'false';
  if (value.type === 'string') return JSON.stringify(value.value);
  if (value.type === 'integer') return String(value.value);
  if (value.type === 'fractional') {
    if (!Number.isFinite(value.value)) return null;
    return String(Number(value.value.toPrecision(6)));
  }
  return null;
}

function computeConstants(text) {
  const tokens = tokenize(text).filter((t) => t.type !== 'comment');
  const assignmentCounts = new Map();
  const topLevel = new Map();
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.value === '{') {
      depth++;
      continue;
    }
    if (token.value === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.type !== 'ident' || token.value !== 'var') continue;

    const previous = tokens[i - 1];
    if (previous && previous.type === 'ident' && previous.value === 'define') continue;

    const nameToken = tokens[i + 1];
    const equals = tokens[i + 2];
    if (!nameToken || nameToken.type !== 'ident' || !equals || equals.value !== '=') continue;

    const name = nameToken.value;
    assignmentCounts.set(name, (assignmentCounts.get(name) || 0) + 1);
    if (depth === 0 && !topLevel.has(name)) {
      const parser = new ExprParser(tokens, i + 3);
      try {
        topLevel.set(name, { ast: parser.parseExpression(), token: nameToken });
      } catch (error) {
        topLevel.set(name, { ast: null, token: nameToken });
      }
    }
  }

  const candidates = new Map();
  for (const [name, info] of topLevel) {
    if (assignmentCounts.get(name) === 1 && info.ast) candidates.set(name, info);
  }

  const values = new Map();
  const resolving = new Set();

  const resolveName = (name) => {
    if (values.has(name)) return values.get(name);
    if (resolving.has(name)) return null;
    const info = candidates.get(name);
    if (!info) return null;
    resolving.add(name);
    const value = evaluateNode(info.ast, resolveName);
    resolving.delete(name);
    if (value) values.set(name, value);
    return value;
  };

  for (const name of candidates.keys()) resolveName(name);

  const result = new Map();
  for (const [name, value] of values) {
    const display = formatValue(value);
    if (display !== null) result.set(name, { type: value.type, value: value.value, display });
  }
  return result;
}

const cache = new Map();

function getConstants(document) {
  const key = document.uri.toString();
  const cached = cache.get(key);
  if (cached && cached.version === document.version) return cached.constants;
  const constants = computeConstants(document.getText());
  cache.set(key, { version: document.version, constants });
  return constants;
}

function clearConstants(uri) {
  cache.delete(uri.toString());
}

module.exports = { computeConstants, getConstants, clearConstants };
