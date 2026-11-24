'use strict';

const RESERVED = new Set([
  'bool', 'integer', 'fractional', 'string', 'analogue', 'list', 'type', 'member',
  'define', 'var', 'param', 'function', 'call', 'on_tick', 'in', 'out', 'if',
  'elseif', 'else', 'repeat', 'true', 'false', 'contains', 'requires',
]);

const BUILTIN_TYPES = new Set(['bool', 'integer', 'fractional', 'string', 'analogue']);
const LIST_ELEMENT_OK = new Set(['bool', 'integer', 'fractional']);

const BUILTINS = new Set([
  'abs', 'floor', 'ceil', 'round', 'sqrt', 'exp', 'ln', 'log2', 'sin', 'cos',
  'tan', 'asin', 'acos', 'atan', 'rand', 'len', 'to_integer', 'to_fractional',
]);

const LIST_METHODS = new Set(['append', 'insert', 'erase', 'clear']);
const UNSUPPORTED = new Set(['while', 'for', 'do', 'switch', 'break', 'continue', 'return', 'goto']);

const TOKEN_RE =
  /#[^\n]*|"[^"\n]*"|"[^"\n]*|[A-Za-z_][A-Za-z0-9_]*|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|&&|\|\||==|!=|>=|<=|\+=|-=|\*=|\/=|%=|\+\+|--|[{}()\[\],;.]|[+\-*/%^<>=!]|[^\s]/g;

const isListType = (t) => typeof t === 'string' && t.startsWith('list<') && t.endsWith('>');
const elementTypeOf = (t) => t.slice(5, -1);
const isNumeric = (t) => t === 'integer' || t === 'fractional';

function tokenize(text) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(text))) {
    const value = match[0];
    let type;
    if (value[0] === '#') type = 'comment';
    else if (value[0] === '"') type = 'string';
    else if (/^[A-Za-z_]/.test(value)) type = 'ident';
    else if (/^(?:\d|\.\d)/.test(value)) type = 'number';
    else type = 'punct';
    tokens.push({ type, value, start: match.index, end: match.index + value.length });
  }
  return tokens;
}

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const distance = Array.from({ length: rows }, () => new Array(columns).fill(0));
  for (let i = 0; i < rows; i++) distance[i][0] = i;
  for (let j = 0; j < columns; j++) distance[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      distance[i][j] =
        a[i - 1] === b[j - 1]
          ? distance[i - 1][j - 1]
          : 1 + Math.min(distance[i - 1][j], distance[i][j - 1], distance[i - 1][j - 1]);
    }
  }
  return distance[a.length][b.length];
}

function tokenKey(path) {
  return path.split(/[._]/).sort().join('\u0000');
}

function closestKey(path, keys) {
  const target = tokenKey(path);
  const reordered = keys.find((key) => tokenKey(key) === target);
  if (reordered) return reordered;

  let best = null;
  let bestDistance = Infinity;
  for (const key of keys) {
    const distance = levenshtein(path, key);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  if (best === null) return null;
  const threshold = Math.max(3, Math.floor(path.length / 3));
  return bestDistance <= threshold ? best : null;
}

class Checker {
  constructor(text, schema) {
    this.text = text;
    this.tokens = tokenize(text);
    this.codeTokens = this.tokens.filter((t) => t.type !== 'comment');
    this.lineStarts = computeLineStarts(text);
    this.diagnostics = [];
    this.schema = schema || null;

    this.globals = new Map();
    this.functions = new Map();
    this.types = new Map();
    this.declarationsByName = new Map();
    this.onTickTokens = [];

    this.scopes = [];
    this.scopeCounter = 0;
    this.pos = 0;
    this.currentFunction = null;

    this.guards = [];
    this.databusWarnings = new Set();
    this.contextStack = [];
  }

  run() {
    this.checkComments();
    this.checkLexical();
    this.collectTopLevel();
    this.validateDeclarations();
    this.checkStructure();
    this.parseProgram();
    return this.diagnostics;
  }

  lineOf(offset) {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  lastToken() {
    if (this.pos > 0 && this.codeTokens[this.pos - 1]) return this.codeTokens[this.pos - 1];
    if (this.codeTokens.length) return this.codeTokens[this.codeTokens.length - 1];
    return { start: 0, end: 0 };
  }

  reportAt(token, message, severity = 'error', extra) {
    const t = token || this.lastToken();
    const diagnostic = { start: t.start, end: t.end, message, severity };
    if (extra) Object.assign(diagnostic, extra);
    this.diagnostics.push(diagnostic);
  }

  reportOffset(start, end, message, severity = 'error', extra) {
    const diagnostic = { start, end, message, severity };
    if (extra) Object.assign(diagnostic, extra);
    this.diagnostics.push(diagnostic);
  }

  checkComments() {
    for (const t of this.tokens) {
      if (t.type !== 'comment') continue;
      if (t.value.length > 31) {
        this.reportAt(t, `comment is ${t.value.length} characters; maximum is 31`, 'warning');
      }
    }
  }

  checkLexical() {
    for (const t of this.codeTokens) {
      if (t.type === 'string') {
        if (t.value.length < 2 || !t.value.endsWith('"')) {
          this.reportAt(t, 'unterminated string literal');
        }
        continue;
      }
      const v = t.value;
      if (v === '!=') {
        this.reportAt(t, "operator '!=' is not supported; use '! (a == b)'");
      } else if (['+=', '-=', '*=', '/=', '%=', '++', '--'].includes(v)) {
        this.reportAt(t, `operator '${v}' is not supported`);
      } else if (v === ';') {
        this.reportAt(t, 'semicolons / multiple statements per line are not supported', 'error', {
          code: 'semicolon',
          fix: { title: 'Remove semicolon', edits: [{ start: t.start, end: t.end, newText: '' }] },
        });
      } else if (t.type === 'number') {
        if (v.startsWith('.')) {
          this.reportAt(t, 'fractional literals need a digit before the dot (write 0.5)', 'error', {
            code: 'leading-dot',
            fix: { title: "Insert leading '0'", edits: [{ start: t.start, end: t.start, newText: '0' }] },
          });
        }
        if (/[eE]/.test(v)) {
          this.reportAt(t, 'exponent notation is not supported');
        }
      } else if (t.type === 'ident' && UNSUPPORTED.has(v)) {
        this.reportAt(t, `'${v}' is not supported`);
      }
    }
  }

  registerName(name, token, scopeKey, kind) {
    if (RESERVED.has(name)) {
      this.reportAt(token, `'${name}' is a reserved keyword and cannot be used as a name`);
    }

    const existing = this.declarationsByName.get(name);
    if (!existing) {
      this.declarationsByName.set(name, [{ token, scopeKey, kind }]);
      return;
    }

    const sameScope = existing.find((declaration) => declaration.scopeKey === scopeKey);
    if (sameScope) {
      this.reportAt(
        token,
        `'${name}' is already declared in this scope (first at line ${this.lineOf(sameScope.token.start)})`
      );
    } else {
      const first = existing[0];
      this.reportAt(
        token,
        `'${name}' is also declared at line ${this.lineOf(first.token.start)}; reusing a name across scopes works but is discouraged`,
        'warning'
      );
    }
    existing.push({ token, scopeKey, kind });
  }

  collectTopLevel() {
    const tokens = this.codeTokens;
    let depth = 0;
    let i = 0;
    let functionOrder = 0;

    while (i < tokens.length) {
      const t = tokens[i];
      if (t.value === '{') {
        depth++;
        i++;
        continue;
      }
      if (t.value === '}') {
        depth = Math.max(0, depth - 1);
        i++;
        continue;
      }
      if (depth !== 0 || t.type !== 'ident') {
        i++;
        continue;
      }

      if (t.value === 'on_tick') {
        this.onTickTokens.push(t);
        i++;
        continue;
      }

      if (t.value !== 'define') {
        i++;
        continue;
      }

      const kw = tokens[i + 1];
      if (!kw || kw.type !== 'ident') {
        i++;
        continue;
      }

      if (kw.value === 'var' || kw.value === 'list') {
        const typeTok = tokens[i + 2];
        const nameTok = tokens[i + 3];
        if (typeTok && nameTok && typeTok.type === 'ident' && nameTok.type === 'ident') {
          this.registerName(nameTok.value, nameTok, 'global', 'global');
          const type = kw.value === 'list' ? `list<${typeTok.value}>` : typeTok.value;
          this.globals.set(nameTok.value, {
            type,
            token: nameTok,
            isList: kw.value === 'list',
            elemToken: typeTok,
          });
        }
        i += 4;
        continue;
      }

      if (kw.value === 'type') {
        const nameTok = tokens[i + 2];
        if (nameTok && nameTok.type === 'ident') {
          this.registerName(nameTok.value, nameTok, 'global', 'type');
          const members = new Map();
          let j = i + 3;
          while (j < tokens.length && tokens[j].value !== '{') j++;
          if (j < tokens.length) {
            j++;
            let inner = 0;
            while (j < tokens.length) {
              const u = tokens[j];
              if (u.value === '{') {
                inner++;
                j++;
                continue;
              }
              if (u.value === '}') {
                if (inner === 0) break;
                inner--;
                j++;
                continue;
              }
              if (u.type === 'ident' && u.value === 'define' && tokens[j + 1] && tokens[j + 1].value === 'member') {
                const mtype = tokens[j + 2];
                const mname = tokens[j + 3];
                if (mtype && mtype.value === 'list') {
                  this.reportAt(mtype, 'list members are not supported');
                  j += 1;
                  continue;
                }
                if (mtype && mname && mtype.type === 'ident' && mname.type === 'ident') {
                  this.registerName(mname.value, mname, `type:${nameTok.value}`, 'member');
                  members.set(mname.value, { type: mtype.value, token: mname, typeToken: mtype });
                  j += 4;
                  continue;
                }
              }
              j++;
            }
            this.types.set(nameTok.value, { members, token: nameTok });
            i = j + 1;
            continue;
          }
        }
        i++;
        continue;
      }

      if (kw.value === 'function') {
        const nameTok = tokens[i + 2];
        if (nameTok && nameTok.type === 'ident') {
          this.registerName(nameTok.value, nameTok, 'global', 'function');
          const params = [];
          const paramMap = new Map();
          let j = i + 3;
          if (tokens[j] && tokens[j].value === '(') {
            j++;
            while (j < tokens.length && tokens[j].value !== ')') {
              const ptype = tokens[j];
              const pname = tokens[j + 1];
              if (ptype && pname && ptype.type === 'ident' && pname.type === 'ident') {
                this.registerName(pname.value, pname, `function:${nameTok.value}`, 'param');
                const param = { name: pname.value, type: ptype.value, token: pname, typeToken: ptype };
                params.push(param);
                paramMap.set(pname.value, param);
                j += 2;
              } else {
                j++;
              }
            }
          }
          this.functions.set(nameTok.value, {
            params,
            paramMap,
            token: nameTok,
            order: functionOrder++,
          });
          let k = i + 3;
          while (k < tokens.length && tokens[k].value !== ')') k++;
          i = k + 1;
          continue;
        }
        i++;
        continue;
      }

      i++;
    }
  }

  validateDeclarations() {
    for (const [, info] of this.globals) {
      if (info.isList) {
        const elem = info.elemToken.value;
        if (elem === 'string') {
          this.reportAt(info.elemToken, "'define list string' crashes at runtime");
        } else if (!LIST_ELEMENT_OK.has(elem) && !this.types.has(elem)) {
          this.reportAt(info.elemToken, `unsupported list element type '${elem}'`);
        }
      } else {
        const t = info.type;
        if (t === 'list') {
          this.reportAt(info.elemToken, "use 'define list', not 'define var list'");
        } else if (!BUILTIN_TYPES.has(t) && !this.types.has(t)) {
          this.reportAt(info.elemToken, `unknown type '${t}'`);
        }
      }
    }

    for (const [, fn] of this.functions) {
      for (const p of fn.params) {
        if (!BUILTIN_TYPES.has(p.type) && !this.types.has(p.type)) {
          this.reportAt(p.typeToken, `unknown parameter type '${p.type}'`);
        }
      }
    }

    for (const [, info] of this.types) {
      for (const [, m] of info.members) {
        if (!BUILTIN_TYPES.has(m.type) && !this.types.has(m.type)) {
          this.reportAt(m.typeToken, `unknown member type '${m.type}'`);
        }
      }
    }

    this.checkRecursiveTypes();
  }

  checkRecursiveTypes() {
    const state = new Map();
    const visit = (name) => {
      if (state.get(name) === 1) return true;
      if (state.get(name) === 2) return false;
      state.set(name, 1);
      const info = this.types.get(name);
      let cyclic = false;
      if (info) {
        for (const [, m] of info.members) {
          if (this.types.has(m.type) && visit(m.type)) cyclic = true;
        }
      }
      state.set(name, 2);
      if (cyclic && info) this.reportAt(info.token, `recursive type '${name}' is not supported`);
      return cyclic;
    };
    for (const name of this.types.keys()) visit(name);
  }

  checkStructure() {
    if (this.onTickTokens.length === 0) {
      const prefix = this.text.endsWith('\n') ? '\n' : '\n\n';
      this.reportOffset(0, 0, "no 'on_tick' entrypoint defined", 'warning', {
        code: 'no-on-tick',
        fix: {
          title: "Add empty 'on_tick' block",
          edits: [{ start: this.text.length, end: this.text.length, newText: `${prefix}on_tick\n{\n}\n` }],
        },
      });
      return;
    }
    for (let i = 1; i < this.onTickTokens.length; i++) {
      this.reportAt(this.onTickTokens[i], "only one 'on_tick' block is allowed");
    }
    const onTick = this.onTickTokens[0];
    for (const [, fn] of this.functions) {
      if (fn.token.start > onTick.start) {
        this.reportAt(fn.token, "functions must be defined before 'on_tick'");
      }
    }
  }

  parseProgram() {
    const globalVars = new Map();
    for (const [name, info] of this.globals) {
      globalVars.set(name, { type: info.type, kind: 'global', token: info.token });
    }
    this.scopes = [{ kind: 'global', key: 'global', vars: globalVars }];
    this.contextStack = ['global'];
    this.pos = 0;
    while (!this.atEnd()) {
      const before = this.pos;
      this.parseStatement(true);
      if (this.pos === before) this.pos++;
    }
  }

  peek(offset = 0) {
    return this.codeTokens[this.pos + offset];
  }

  atEnd() {
    return this.pos >= this.codeTokens.length;
  }

  next() {
    return this.codeTokens[this.pos++];
  }

  check(value) {
    const t = this.peek();
    return !!t && t.value === value;
  }

  match(value) {
    if (this.check(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(value, message) {
    if (this.match(value)) return true;
    this.reportAt(this.peek() || this.lastToken(), message || `expected '${value}'`);
    return false;
  }

  isIdent(t) {
    return !!t && t.type === 'ident';
  }

  pushScope(kind, key) {
    this.scopes.push({ kind, key: key || `block:${this.scopeCounter++}`, vars: new Map() });
  }

  popScope() {
    this.scopes.pop();
  }

  currentScope() {
    return this.scopes[this.scopes.length - 1];
  }

  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope.vars.has(name)) return scope.vars.get(name);
    }
    return null;
  }

  declareLocal(name, type, token) {
    this.registerName(name, token, this.currentScope().key, 'local');
    this.currentScope().vars.set(name, { type, kind: 'local', token });
  }

  parseStatement(topLevel) {
    const t = this.peek();
    if (!t) return;
    if (t.type === 'ident') {
      switch (t.value) {
        case 'define':
          return this.parseDefinition(topLevel);
        case 'var':
          return this.parseVarStatement(topLevel);
        case 'param':
          return this.parseParamStatement(topLevel);
        case 'in':
          return this.parseInStatement();
        case 'call':
          return this.parseCallStatement(topLevel);
        case 'if':
          return this.parseIf();
        case 'repeat':
          return this.parseRepeat(topLevel);
        case 'on_tick':
          return this.parseOnTick(topLevel);
        case 'requires':
          return this.parseRequires();
        case 'out':
          this.reportAt(t, "'out' databus values can only be used inside expressions");
          return this.next();
        case 'else':
        case 'elseif':
          this.reportAt(t, `unexpected '${t.value}'`);
          return this.next();
        default:
          this.reportAt(t, `unexpected '${t.value}'`);
          return this.next();
      }
    }
    this.reportAt(t, `unexpected token '${t.value}'`);
    return this.next();
  }

  parseDefinition(topLevel) {
    const defineTok = this.next();
    const kw = this.peek();
    if (!this.isIdent(kw)) {
      this.reportAt(defineTok, "expected 'var', 'list', 'type', 'member' or 'function' after 'define'");
      return;
    }
    switch (kw.value) {
      case 'var':
        return this.parseVarDecl(topLevel, false);
      case 'list':
        return this.parseVarDecl(topLevel, true);
      case 'function':
        return this.parseFunctionDecl(topLevel);
      case 'type':
        return this.parseTypeDecl(topLevel);
      case 'member':
        this.reportAt(kw, "'define member' is only allowed inside a type");
        this.next();
        if (this.isIdent(this.peek())) this.next();
        if (this.isIdent(this.peek())) this.next();
        return;
      default:
        this.reportAt(kw, `unknown declaration 'define ${kw.value}'`);
        this.next();
    }
  }

  parseVarDecl(topLevel, isList) {
    const kindTok = this.next();
    const typeTok = this.peek();
    if (!this.isIdent(typeTok)) {
      this.reportAt(kindTok, `expected ${isList ? 'element type' : 'type'} after '${kindTok.value}'`);
      return;
    }
    this.next();
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(typeTok, 'expected variable name');
      return;
    }
    this.next();

    if (!topLevel) {
      let type;
      if (isList) {
        type = `list<${typeTok.value}>`;
        if (typeTok.value === 'string') {
          this.reportAt(typeTok, "'define list string' crashes at runtime");
        } else if (!LIST_ELEMENT_OK.has(typeTok.value) && !this.types.has(typeTok.value)) {
          this.reportAt(typeTok, `unsupported list element type '${typeTok.value}'`);
        }
      } else {
        type = typeTok.value;
        if (type === 'list') {
          this.reportAt(typeTok, "use 'define list', not 'define var list'");
        } else if (!BUILTIN_TYPES.has(type) && !this.types.has(type)) {
          this.reportAt(typeTok, `unknown type '${type}'`);
        }
      }
      this.declareLocal(nameTok.value, type, nameTok);
    }

    if (this.check('=')) {
      const equalsTok = this.next();
      this.parseExpr();
      const last = this.codeTokens[this.pos - 1] || equalsTok;
      this.reportAt(equalsTok, `'define ${kindTok.value}' takes no initializer`, 'error', {
        code: 'no-initializer',
        fix: {
          title: 'Remove initializer',
          edits: [{ start: equalsTok.start, end: last.end, newText: '' }],
        },
      });
    }
  }

  parseFunctionDecl(topLevel) {
    const fnTok = this.next();
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(fnTok, 'expected function name');
      return;
    }
    this.next();
    if (!topLevel) {
      this.reportAt(nameTok, "'define function' is only allowed at top level");
    }
    const info = this.functions.get(nameTok.value);

    if (this.check('(')) {
      this.next();
      while (!this.atEnd() && !this.check(')')) this.next();
      this.match(')');
    } else {
      this.reportAt(nameTok, "expected '(' after function name");
    }

    if (!this.check('{')) {
      this.reportAt(nameTok, "expected '{' for function body");
      return;
    }

    const previous = this.currentFunction;
    this.currentFunction = nameTok.value;
    this.pushScope('function', `function:${nameTok.value}`);
    if (info) {
      for (const p of info.params) {
        this.currentScope().vars.set(p.name, { type: p.type, kind: 'param', token: p.token });
      }
    }
    this.contextStack.push(`function:${nameTok.value}`);
    this.parseBlockBody(false);
    this.contextStack.pop();
    this.currentFunction = previous;
    this.popScope();
  }

  parseTypeDecl(topLevel) {
    const typeTok = this.next();
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(typeTok, 'expected type name');
      return;
    }
    this.next();
    if (!topLevel) {
      this.reportAt(nameTok, "'define type' is only allowed at top level");
    }
    this.skipBlock();
  }

  skipBlock() {
    while (!this.atEnd() && !this.check('{')) this.next();
    if (this.atEnd()) {
      this.reportAt(this.lastToken(), "expected '{'");
      return;
    }
    this.checkBlockBrace();
    let depth = 0;
    while (!this.atEnd()) {
      const t = this.next();
      if (t.value === '{') depth++;
      else if (t.value === '}') {
        depth--;
        if (depth === 0) return;
      }
    }
  }

  checkBlockBrace() {
    const brace = this.peek();
    if (!brace || brace.value !== '{') return;
    const previous = this.lastToken();
    if (!previous) return;
    if (this.lineOf(previous.start) !== this.lineOf(brace.start)) return;

    const between = this.text.slice(previous.end, brace.start);
    const extra = { code: 'brace-newline' };
    if (/^[ \t]*$/.test(between)) {
      const lineStart = this.text.lastIndexOf('\n', previous.start - 1) + 1;
      const indentMatch = this.text.slice(lineStart, previous.start).match(/^[ \t]*/);
      const indent = indentMatch ? indentMatch[0] : '';
      extra.fix = {
        title: "Put '{' on a new line",
        edits: [{ start: previous.end, end: brace.start, newText: `\n${indent}` }],
      };
    }
    this.reportAt(brace, "the '{' must be on a new line", 'error', extra);
  }

  parseBlockBody(pushScope, key) {
    this.checkBlockBrace();
    if (!this.match('{')) {
      this.reportAt(this.lastToken(), "expected '{'");
      return;
    }
    if (pushScope) this.pushScope('block', key);
    while (!this.atEnd() && !this.check('}')) {
      const before = this.pos;
      this.parseStatement(false);
      if (this.pos === before) this.next();
    }
    if (!this.match('}')) this.reportAt(this.lastToken(), "expected '}'");
    if (pushScope) this.popScope();
  }

  parseVarStatement() {
    const varTok = this.next();
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(varTok, "expected variable name after 'var'");
      return;
    }
    this.next();

    if (this.check('.')) {
      this.next();
      const memberTok = this.peek();
      if (!this.isIdent(memberTok)) {
        this.reportAt(varTok, 'expected member name');
        return;
      }
      this.next();

      const base = this.lookup(nameTok.value);
      let lhs = 'unknown';
      if (!base) {
        this.reportAt(nameTok, `undeclared variable '${nameTok.value}'`);
      } else if (base.kind === 'param') {
        this.reportAt(nameTok, `'${nameTok.value}' is a parameter; use 'param ${nameTok.value}'`);
      } else if (isListType(base.type)) {
        this.reportAt(memberTok, `list values have no members`);
      } else if (this.types.has(base.type)) {
        const member = this.types.get(base.type).members.get(memberTok.value);
        if (!member) this.reportAt(memberTok, `unknown member '${memberTok.value}'`);
        else lhs = member.type;
      } else if (base.type !== 'unknown') {
        this.reportAt(memberTok, `type '${base.type}' has no members`);
      }

      if (this.check('.')) {
        this.reportAt(this.peek(), 'nested access is not supported; copy to an intermediate variable');
        while (this.check('.')) {
          this.next();
          if (this.isIdent(this.peek())) this.next();
        }
      }
      if (this.match('=')) {
        const rhs = this.parseExpr();
        this.checkAssign(lhs, rhs, memberTok);
      } else {
        this.reportAt(varTok, "expected '=' after member");
      }
      return;
    }

    if (this.check('[')) {
      this.reportAt(varTok, 'list elements are read-only and cannot be assigned');
      this.skipExpressionish();
      if (this.match('=')) this.parseExpr();
      return;
    }

    const sym = this.lookup(nameTok.value);
    if (sym && isListType(sym.type)) {
      const method = this.peek();
      if (method && method.type === 'ident' && LIST_METHODS.has(method.value)) {
        this.next();
        const elem = elementTypeOf(sym.type);
        if (method.value === 'clear') {
          if (this.check('(')) this.reportAt(this.peek(), "'clear' takes no parentheses");
          return;
        }
        if (!this.match('(')) {
          this.reportAt(method, "expected '(' after list method");
          return;
        }
        const args = [];
        while (!this.atEnd() && !this.check(')')) {
          const before = this.pos;
          args.push(this.parseExpr());
          if (this.pos === before) this.next();
          if (!this.match(',')) break;
        }
        this.match(')');
        if (method.value === 'append') {
          if (args.length !== 1) this.reportAt(method, "'append' takes 1 argument");
          else this.checkAssign(elem, args[0], method);
        } else if (method.value === 'insert') {
          if (args.length !== 2) this.reportAt(method, "'insert' takes 2 arguments");
          else {
            this.checkAssign(elem, args[0], method);
            if (args[1] !== 'integer' && args[1] !== 'unknown') {
              this.reportAt(method, "'insert' index must be an integer");
            }
          }
        } else if (method.value === 'erase') {
          if (args.length !== 1) this.reportAt(method, "'erase' takes 1 argument");
          else if (args[0] !== 'integer' && args[0] !== 'unknown') {
            this.reportAt(method, "'erase' index must be an integer");
          }
        }
        return;
      }
    }

    if (!sym) this.reportAt(nameTok, `undeclared variable '${nameTok.value}'`);
    else if (sym.kind === 'param') this.reportAt(nameTok, `'${nameTok.value}' is a parameter; use 'param ${nameTok.value}'`);

    if (this.match('=')) {
      const rhs = this.parseExpr();
      if (sym) this.checkAssign(sym.type, rhs, nameTok);
    } else {
      this.reportAt(varTok, "expected '=' or a list method (append/insert/erase/clear)");
    }
  }

  parseParamStatement() {
    const paramTok = this.next();
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(paramTok, 'expected parameter name');
      return;
    }
    this.next();

    const sym = this.lookup(nameTok.value);
    if (!sym || sym.kind !== 'param') {
      this.reportAt(nameTok, `'${nameTok.value}' is not a parameter`);
    }

    if (this.check('.')) {
      this.reportAt(this.peek(), 'cannot assign to a parameter member; copy it to a local first');
      while (this.check('.')) {
        this.next();
        if (this.isIdent(this.peek())) this.next();
      }
      if (this.match('=')) this.parseExpr();
      return;
    }

    if (this.match('=')) {
      const rhs = this.parseExpr();
      if (sym && sym.kind === 'param') this.checkAssign(sym.type, rhs, nameTok);
    } else {
      this.reportAt(paramTok, "expected '=' after parameter name");
    }
  }

  parseInStatement() {
    const inTok = this.next();
    const first = this.peek();
    if (!this.isIdent(first)) {
      this.reportAt(inTok, "expected databus path after 'in'");
      return;
    }
    this.next();
    let path = first.value;
    let last = first;
    while (this.check('.')) {
      this.next();
      const segment = this.peek();
      if (!this.isIdent(segment)) {
        this.reportAt(this.lastToken(), 'expected databus path segment');
        break;
      }
      this.next();
      path += '.' + segment.value;
      last = segment;
    }

    const known = this.schema ? this.validateDatabus('in', path, first, last) : null;
    if (!this.schema || known) {
      this.warnUncheckedDatabus('in', path, { start: first.start, end: last.end });
    }
    let rhs = null;
    if (this.match('=')) {
      rhs = this.parseExpr();
    } else {
      this.reportAt(inTok, "expected '=' after databus input path");
    }
    if (known && rhs) {
      this.checkAssign(known, rhs, last, 'databus in');
    }
  }

  validateDatabus(direction, path, first, last) {
    if (!this.schema) return null;
    const own = this.schema[direction] || {};
    const otherDirection = direction === 'in' ? 'out' : 'in';
    const other = this.schema[otherDirection] || {};
    const token = { start: first.start, end: last.end };
    if (path in own) {
      return own[path] && own[path].type ? own[path].type : 'unknown';
    }
    if (path in other) {
      this.reportAt(
        token,
        `databus path '${path}' is an '${otherDirection}' variable; use '${otherDirection} ${path}'`
      );
    } else {
      const suggestion = closestKey(path, Object.keys(own));
      const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
      const extra = { code: 'unknown-databus' };
      if (suggestion) {
        extra.fix = {
          title: `Change to '${suggestion}'`,
          edits: [{ start: first.start, end: last.end, newText: suggestion }],
        };
      }
      this.reportAt(token, `unknown databus '${direction}' path '${path}'.${hint}`, 'error', extra);
    }
    return null;
  }

  parseCallStatement(topLevel) {
    const callTok = this.next();
    if (topLevel) {
      this.reportAt(callTok, 'user-defined function calls are not allowed in top-level code');
    }
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(callTok, "expected function name after 'call'");
      return;
    }
    this.next();

    const info = this.functions.get(nameTok.value);
    if (!info) {
      this.reportAt(nameTok, `unknown function '${nameTok.value}'`);
    } else {
      if (info.token.start > callTok.start) {
        this.reportAt(nameTok, `function '${nameTok.value}' must be defined before it is called`);
      }
      if (this.currentFunction === nameTok.value) {
        this.reportAt(nameTok, 'recursion is not supported');
      }
    }

    if (!this.match('(')) {
      this.reportAt(nameTok, "expected '(' after function name");
      return;
    }
    const args = [];
    while (!this.atEnd() && !this.check(')')) {
      const before = this.pos;
      args.push(this.parseExpr());
      if (this.pos === before) this.next();
      if (!this.match(',')) break;
    }
    this.match(')');

    if (info) {
      if (args.length !== info.params.length) {
        this.reportAt(nameTok, `function '${nameTok.value}' expects ${info.params.length} argument(s), got ${args.length}`);
      } else {
        for (let i = 0; i < args.length; i++) {
          this.checkAssign(info.params[i].type, args[i], nameTok, `argument ${i + 1}`);
        }
      }
    }
  }

  parseIf() {
    const ifTok = this.next();
    this.parseCondition(ifTok, 'if');
    this.parseBlockBody(true);
    while (this.check('elseif')) {
      const tok = this.next();
      this.parseCondition(tok, 'elseif');
      this.parseBlockBody(true);
    }
    if (this.check('else')) {
      const elseTok = this.next();
      if (this.check('if')) {
        const ifTok = this.peek();
        this.reportAt(ifTok, "use 'elseif', not 'else if'", 'error', {
          code: 'else-if',
          fix: {
            title: "Replace with 'elseif'",
            edits: [{ start: elseTok.start, end: ifTok.end, newText: 'elseif' }],
          },
        });
        const tok = this.next();
        this.parseCondition(tok, 'if');
        this.parseBlockBody(true);
      } else {
        this.parseBlockBody(true);
      }
    }
  }

  parseCondition(tok, name) {
    if (!this.match('(')) {
      this.reportAt(tok, `expected '(' after '${name}'`);
      return;
    }
    const start = this.peek();
    const type = this.parseExpr();
    if (!this.match(')')) this.reportAt(this.lastToken(), "expected ')'");
    if (type !== 'bool' && type !== 'unknown') {
      this.reportAt(start || tok, `'${name}' condition must be bool, got ${type}`);
    }
  }

  parseRepeat(topLevel) {
    const tok = this.next();
    if (topLevel) {
      this.reportAt(tok, "'repeat' is not allowed in top-level code");
    }
    if (!this.match('(')) {
      this.reportAt(tok, "expected '(' after 'repeat'");
    } else {
      const start = this.peek();
      const type = this.parseExpr();
      if (!this.match(')')) this.reportAt(this.lastToken(), "expected ')'");
      if (type !== 'integer' && type !== 'unknown') {
        this.reportAt(start || tok, "'repeat' count must be an integer");
      }
    }
    this.parseBlockBody(true);
  }

  parseOnTick(topLevel) {
    const tok = this.next();
    if (!topLevel) this.reportAt(tok, "'on_tick' must be defined at top level");
    this.contextStack.push('on_tick');
    this.parseBlockBody(true, 'ontick');
    this.contextStack.pop();
  }

  parseRequires() {
    const requiresTok = this.next();
    if (!this.match('(')) {
      this.reportAt(requiresTok, "expected '(' after 'requires'");
      return;
    }

    const directionTok = this.peek();
    if (!this.isIdent(directionTok) || (directionTok.value !== 'in' && directionTok.value !== 'out')) {
      this.reportAt(directionTok || requiresTok, "requires expects an 'in' or 'out' databus variable");
      while (!this.atEnd() && !this.check(')')) this.next();
      this.match(')');
      this.parseBlockBody(true);
      return;
    }
    this.next();

    const first = this.peek();
    if (!this.isIdent(first)) {
      this.reportAt(requiresTok, `expected databus path after '${directionTok.value}'`);
      while (!this.atEnd() && !this.check(')')) this.next();
      this.match(')');
      this.parseBlockBody(true);
      return;
    }
    this.next();

    let path = first.value;
    let last = first;
    while (this.check('.')) {
      this.next();
      const segment = this.peek();
      if (!this.isIdent(segment)) {
        this.reportAt(this.lastToken(), 'expected databus path segment');
        break;
      }
      this.next();
      path += '.' + segment.value;
      last = segment;
    }

    if (this.schema) this.validateDatabus(directionTok.value, path, first, last);

    if (!this.check(')')) {
      this.reportAt(this.peek() || last, 'requires takes a single databus variable');
      while (!this.atEnd() && !this.check(')')) this.next();
    }
    this.match(')');

    this.guards.push({ direction: directionTok.value, path });
    this.parseBlockBody(true);
    this.guards.pop();
  }

  warnUncheckedDatabus(direction, path, token) {
    if (this.guards.some((guard) => guard.direction === direction && guard.path === path)) return;
    const context = this.contextStack[this.contextStack.length - 1] || 'global';
    const key = `${context}|${direction}|${path}`;
    if (this.databusWarnings.has(key)) return;
    this.databusWarnings.add(key);
    this.reportAt(
      token,
      `databus '${direction} ${path}' is used without a 'requires' guard; if it is missing at runtime, the whole script can fail`,
      'warning',
      { code: 'unchecked-databus' }
    );
  }

  skipExpressionish() {
    let depth = 0;
    while (!this.atEnd()) {
      const t = this.peek();
      if (t.value === '[' || t.value === '(') depth++;
      else if (t.value === ']' || t.value === ')') {
        if (depth === 0) return;
        depth--;
      } else if (depth === 0 && (t.value === '=' || t.value === '}')) {
        return;
      }
      this.next();
    }
  }

  parseExpr() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.check('||')) {
      const op = this.next();
      const right = this.parseAnd();
      this.requireBool(left, op, "'||'");
      this.requireBool(right, op, "'||'");
      left = 'bool';
    }
    return left;
  }

  parseAnd() {
    let left = this.parseComparison();
    while (this.check('&&')) {
      const op = this.next();
      const right = this.parseComparison();
      this.requireBool(left, op, "'&&'");
      this.requireBool(right, op, "'&&'");
      left = 'bool';
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAdd();
    let seen = false;
    while (this.peek() && ['==', '>', '<', '>=', '<=', 'contains'].includes(this.peek().value)) {
      const op = this.next();
      if (seen) this.reportAt(op, 'chained comparisons are not supported; combine them with &&');
      seen = true;
      const right = this.parseAdd();
      left = this.checkComparison(op, left, right);
    }
    return left;
  }

  checkComparison(op, left, right) {
    if (op.value === 'contains') {
      if (left !== 'unknown' && !isListType(left)) {
        this.reportAt(op, "'contains' is only valid on lists");
      }
      if (isListType(left) && right !== 'unknown') {
        const elem = elementTypeOf(left);
        if (elem !== right) this.reportAt(op, `list element type is ${elem}, got ${right}`);
      }
      return 'bool';
    }
    if (op.value === '==') {
      if (isListType(left) || isListType(right)) {
        this.reportAt(op, "'==' is not supported for lists");
      } else if (left !== 'unknown' && right !== 'unknown' && left !== right) {
        this.reportAt(op, `operand types must match: ${left} vs ${right}`);
      }
      return 'bool';
    }
    if (isListType(left) || isListType(right)) {
      this.reportAt(op, `operator '${op.value}' is not supported for lists`);
    } else if (left !== 'unknown' && right !== 'unknown' && left !== right) {
      this.reportAt(op, `operand types must match: ${left} vs ${right}`);
    }
    return 'bool';
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.check('+') || this.check('-')) {
      const op = this.next();
      const right = this.parseMul();
      left = this.checkArith(op, left, right);
    }
    return left;
  }

  parseMul() {
    let left = this.parsePow();
    while (this.check('*') || this.check('/') || this.check('%')) {
      const op = this.next();
      const right = this.parsePow();
      left = this.checkArith(op, left, right);
    }
    return left;
  }

  parsePow() {
    let left = this.parseUnary();
    while (this.check('^')) {
      const op = this.next();
      const right = this.parseUnary();
      left = this.checkArith(op, left, right);
    }
    return left;
  }

  checkArith(op, left, right) {
    if (left === 'unknown' || right === 'unknown') return 'unknown';
    if (!isNumeric(left) || !isNumeric(right)) {
      this.reportAt(op, `arithmetic operands must be integer or fractional, got ${left} and ${right}`);
      return 'unknown';
    }
    if (left !== right) {
      this.reportAt(op, 'cannot mix integer and fractional; convert one first');
      return 'unknown';
    }
    return left;
  }

  parseUnary() {
    if (this.check('!')) {
      const op = this.next();
      const nextTok = this.peek();
      if (nextTok && nextTok.value === '(') {
        if (op.end === nextTok.start) {
          this.reportAt(op, "add a space between '!' and '('", 'warning', {
            code: 'bang-spacing',
            fix: { title: 'Insert space', edits: [{ start: op.end, end: op.end, newText: ' ' }] },
          });
        }
        this.next();
        const type = this.parseOr();
        if (!this.match(')')) this.reportAt(this.lastToken(), "expected ')'");
        this.requireBool(type, op, "'!'");
        return 'bool';
      }
      this.reportAt(op, "'!' must be followed by a space and a parenthesized operand");
      const type = this.parseUnary();
      this.requireBool(type, op, "'!'");
      return 'bool';
    }
    if (this.check('-')) {
      const op = this.next();
      const nt = this.peek();
      if (nt && nt.type === 'number') {
        this.next();
        return this.numberType(nt);
      }
      this.reportAt(op, "unary '-' is only allowed on numeric literals");
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  requireBool(type, token, what) {
    if (type !== 'bool' && type !== 'unknown') {
      this.reportAt(token, `${what} operands must be bool, got ${type}`);
    }
  }

  numberType(token) {
    return token.value.includes('.') ? 'fractional' : 'integer';
  }

  parsePrimary() {
    const t = this.peek();
    if (!t) {
      this.reportAt(this.lastToken(), 'unexpected end of expression');
      return 'unknown';
    }
    if (t.type === 'number') {
      this.next();
      return this.numberType(t);
    }
    if (t.type === 'string') {
      this.next();
      return 'string';
    }
    if (t.value === '(') {
      this.next();
      const type = this.parseOr();
      if (!this.match(')')) this.reportAt(this.lastToken(), "expected ')'");
      return type;
    }
    if (t.value === '[') {
      this.reportAt(t, 'list literals are not supported');
      this.skipBracket();
      return 'unknown';
    }
    if (t.type === 'ident') {
      if (t.value === 'true' || t.value === 'false') {
        this.next();
        return 'bool';
      }
      if (t.value === 'var') return this.parseVarPrimary();
      if (t.value === 'param') return this.parseParamPrimary();
      if (t.value === 'out') return this.parseOutPrimary();
      if (t.value === 'in') {
        this.reportAt(t, "'in' databus values are write-only and cannot be read");
        this.next();
        return 'unknown';
      }
      if (BUILTINS.has(t.value) && this.peek(1) && this.peek(1).value === '(') {
        return this.parseBuiltinCall();
      }
      if (this.peek(1) && this.peek(1).value === '(') {
        this.reportAt(t, `unknown function '${t.value}'; user functions are called with 'call ${t.value} (...)'`);
        this.next();
        return this.parseUnknownCall();
      }
      this.reportAt(t, `unexpected identifier '${t.value}' (variables must be read with 'var')`);
      this.next();
      return 'unknown';
    }
    this.reportAt(t, `unexpected token '${t.value}'`);
    this.next();
    return 'unknown';
  }

  skipBracket() {
    let depth = 0;
    while (!this.atEnd()) {
      const t = this.next();
      if (t.value === '[') depth++;
      else if (t.value === ']') {
        depth--;
        if (depth === 0) return;
      }
    }
  }

  parseVarPrimary() {
    const varTok = this.next();
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(varTok, "expected variable name after 'var'");
      return 'unknown';
    }
    this.next();

    let type = 'unknown';
    const sym = this.lookup(nameTok.value);
    if (!sym) {
      this.reportAt(nameTok, `undeclared variable '${nameTok.value}'`);
    } else if (sym.kind === 'param') {
      this.reportAt(nameTok, `'${nameTok.value}' is a parameter; use 'param ${nameTok.value}'`);
    } else {
      type = sym.type;
    }

    if (this.check('.')) {
      this.next();
      const memberTok = this.peek();
      if (!this.isIdent(memberTok)) {
        this.reportAt(this.lastToken(), 'expected member name');
        return type;
      }
      this.next();
      if (type !== 'unknown') {
        if (this.types.has(type)) {
          const member = this.types.get(type).members.get(memberTok.value);
          if (!member) this.reportAt(memberTok, `unknown member '${memberTok.value}'`);
          else type = member.type;
        } else if (!isListType(type)) {
          this.reportAt(memberTok, `type '${type}' has no members`);
        }
      }
      if (this.check('.')) {
        this.reportAt(this.peek(), 'nested access is not supported; copy to an intermediate variable');
        while (this.check('.')) {
          this.next();
          if (this.isIdent(this.peek())) this.next();
        }
      }
    }

    if (this.check('[')) {
      this.next();
      const indexStart = this.peek();
      const index = this.parseOr();
      if (!this.match(']')) this.reportAt(this.lastToken(), "expected ']'");
      if (index !== 'integer' && index !== 'unknown') {
        this.reportAt(indexStart || this.lastToken(), 'list index must be an integer');
      }
      if (isListType(type)) type = elementTypeOf(type);
      else if (type !== 'unknown') {
        this.reportAt(nameTok, `type '${type}' is not a list and cannot be indexed`);
      }
    }
    return type;
  }

  parseParamPrimary() {
    const paramTok = this.next();
    const nameTok = this.peek();
    if (!this.isIdent(nameTok)) {
      this.reportAt(paramTok, "expected parameter name after 'param'");
      return 'unknown';
    }
    this.next();

    let type = 'unknown';
    const sym = this.lookup(nameTok.value);
    if (!sym) {
      this.reportAt(nameTok, `undeclared parameter '${nameTok.value}'`);
    } else if (sym.kind !== 'param') {
      this.reportAt(nameTok, `'${nameTok.value}' is not a parameter; use 'var ${nameTok.value}'`);
    } else {
      type = sym.type;
    }

    if (this.check('.')) {
      this.next();
      const memberTok = this.peek();
      if (!this.isIdent(memberTok)) {
        this.reportAt(this.lastToken(), 'expected member name');
        return type;
      }
      this.next();
      if (type !== 'unknown') {
        if (this.types.has(type)) {
          const member = this.types.get(type).members.get(memberTok.value);
          if (!member) this.reportAt(memberTok, `unknown member '${memberTok.value}'`);
          else type = member.type;
        } else {
          this.reportAt(memberTok, `type '${type}' has no members`);
        }
      }
      if (this.check('.')) {
        this.reportAt(this.peek(), 'nested access is not supported; copy to an intermediate variable');
      }
    }
    return type;
  }

  parseOutPrimary() {
    const outTok = this.next();
    const first = this.peek();
    if (!this.isIdent(first)) {
      this.reportAt(outTok, "expected databus path after 'out'");
      return 'unknown';
    }
    this.next();
    let path = first.value;
    let last = first;
    while (this.check('.')) {
      this.next();
      const segment = this.peek();
      if (!this.isIdent(segment)) {
        this.reportAt(this.lastToken(), 'expected databus path segment');
        break;
      }
      this.next();
      path += '.' + segment.value;
      last = segment;
    }
    const known = this.schema ? this.validateDatabus('out', path, first, last) : null;
    if (!this.schema || known) {
      this.warnUncheckedDatabus('out', path, { start: first.start, end: last.end });
    }
    if (!known) return 'unknown';
    return known;
  }

  parseBuiltinCall() {
    const nameTok = this.next();
    const open = this.peek();
    if (!open || open.value !== '(') {
      this.reportAt(nameTok, `expected '(' after '${nameTok.value}'`);
      return 'unknown';
    }
    this.next();
    if (nameTok.end === open.start) {
      this.reportAt(nameTok, `add a space before '(' for '${nameTok.value}'`, 'warning', {
        code: 'call-spacing',
        fix: { title: 'Insert space', edits: [{ start: open.start, end: open.start, newText: ' ' }] },
      });
    }
    const args = [];
    const argTokens = [];
    while (!this.atEnd() && !this.check(')')) {
      const before = this.pos;
      argTokens.push(this.peek());
      args.push(this.parseOr());
      if (this.pos === before) this.next();
      if (!this.match(',')) break;
    }
    this.match(')');
    return this.checkBuiltin(nameTok, args, argTokens);
  }

  parseUnknownCall() {
    if (!this.match('(')) return 'unknown';
    while (!this.atEnd() && !this.check(')')) {
      const before = this.pos;
      this.parseOr();
      if (this.pos === before) this.next();
      if (!this.match(',')) break;
    }
    this.match(')');
    return 'unknown';
  }

  checkBuiltin(nameTok, args, argTokens) {
    const name = nameTok.value;
    const count = args.length;
    const argReport = (i, message) => this.reportAt(argTokens[i] || nameTok, message);
    const expectCount = (n) => {
      if (count !== n) {
        this.reportAt(nameTok, `'${name}' expects ${n} argument(s), got ${count}`);
        return false;
      }
      return true;
    };
    const numericArg = () => {
      if (count < 1) return 'unknown';
      const type = args[0];
      if (type === 'unknown') return 'unknown';
      if (!isNumeric(type)) {
        argReport(0, `'${name}' expects a numeric argument`);
        return 'unknown';
      }
      return type;
    };

    switch (name) {
      case 'abs':
      case 'floor':
      case 'ceil':
      case 'round':
      case 'sqrt':
        expectCount(1);
        return numericArg();
      case 'exp':
      case 'ln':
      case 'log2':
        expectCount(1);
        numericArg();
        return 'fractional';
      case 'sin':
      case 'cos':
      case 'tan':
      case 'asin':
      case 'acos':
      case 'atan':
        expectCount(1);
        if (count >= 1 && args[0] !== 'unknown' && args[0] !== 'fractional') {
          argReport(0, `'${name}' expects a fractional argument`);
        }
        return 'fractional';
      case 'rand':
        expectCount(2);
        if (count === 2) {
          const a = args[0];
          const b = args[1];
          if (a !== 'unknown' && b !== 'unknown') {
            if (!isNumeric(a) || !isNumeric(b)) this.reportAt(nameTok, "'rand' expects numeric arguments");
            else if (a !== b) this.reportAt(nameTok, "'rand' arguments must have the same type");
          }
          return a !== 'unknown' ? a : b;
        }
        return 'unknown';
      case 'len':
        expectCount(1);
        if (count === 1 && args[0] !== 'unknown' && args[0] !== 'string' && !isListType(args[0])) {
          argReport(0, "'len' expects a string or list");
        }
        return 'integer';
      case 'to_integer':
        expectCount(1);
        numericArg();
        return 'integer';
      case 'to_fractional':
        expectCount(1);
        numericArg();
        return 'fractional';
      default:
        return 'unknown';
    }
  }

  checkAssign(lhs, rhs, token, context) {
    if (lhs === 'unknown' || rhs === 'unknown') return;
    if (isListType(lhs)) {
      this.reportAt(token, 'lists cannot be assigned or copied');
      return;
    }
    if (lhs !== rhs) {
      const note = context ? ` (${context})` : '';
      this.reportAt(token, `type mismatch${note}: cannot assign ${rhs} to ${lhs}`);
    }
  }
}

function check(text, schema) {
  return new Checker(text, schema).run();
}

module.exports = { check, tokenize, RESERVED };
