'use strict';

const TOKEN_RE = /#[^\n]*|"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d*)?|&&|\|\||==|>=|<=|[^\s]/g;

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
    else if (/^[0-9]/.test(value)) type = 'number';
    else type = 'punct';
    tokens.push({ type, value, start: match.index, end: match.index + value.length });
  }
  return tokens;
}

function isIdent(token) {
  return token !== undefined && token.type === 'ident';
}

function collectDefinitions(tokens) {
  const symbols = new Map();
  const globalDecls = [];
  const paramDecls = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'punct') {
      if (token.value === '{') depth++;
      else if (token.value === '}') depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.type !== 'ident' || token.value !== 'define') continue;

    const keyword = tokens[i + 1];
    if (isIdent(keyword) && (keyword.value === 'var' || keyword.value === 'list')) {
      const typeTok = tokens[i + 2];
      const nameTok = tokens[i + 3];
      if (isIdent(typeTok) && isIdent(nameTok)) {
        const kind = depth === 0 ? 'global' : 'local';
        symbols.set(nameTok.value, kind);
        if (kind === 'global') globalDecls.push(nameTok);
      }
    } else if (isIdent(keyword) && keyword.value === 'function') {
      let j = i + 3;
      if (tokens[j] && tokens[j].value === '(') {
        j++;
        while (j < tokens.length && tokens[j].value !== ')') {
          const typeTok = tokens[j];
          const nameTok = tokens[j + 1];
          if (isIdent(typeTok) && isIdent(nameTok)) {
            symbols.set(nameTok.value, 'param');
            paramDecls.push(nameTok);
            j += 2;
          } else {
            j++;
          }
        }
      }
    }
  }

  return { symbols, globalDecls, paramDecls };
}

function collectReferences(tokens, symbols) {
  const globalRefs = [];
  const paramRefs = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'ident') continue;

    if (token.value === 'var') {
      const prev = tokens[i - 1];
      if (isIdent(prev) && prev.value === 'define') continue;
      const next = tokens[i + 1];
      if (!isIdent(next)) continue;
      const kind = symbols.get(next.value);
      if (kind === 'global') globalRefs.push(next);
      else if (kind === 'param') paramRefs.push(next);
    } else if (token.value === 'param') {
      const next = tokens[i + 1];
      if (isIdent(next)) paramRefs.push(next);
    }
  }

  return { globalRefs, paramRefs };
}

function collectDatabus(tokens) {
  const inVars = [];
  const outVars = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'ident' || (token.value !== 'in' && token.value !== 'out')) continue;
    const first = tokens[i + 1];
    if (!isIdent(first)) continue;

    let last = first;
    let j = i + 2;
    while (tokens[j] && tokens[j].value === '.' && isIdent(tokens[j + 1])) {
      last = tokens[j + 1];
      j += 2;
    }

    const range = { start: first.start, end: last.end };
    if (token.value === 'in') inVars.push(range);
    else outVars.push(range);
  }

  return { inVars, outVars };
}

function analyze(text) {
  const tokens = tokenize(text);
  const { symbols, globalDecls, paramDecls } = collectDefinitions(tokens);
  const { globalRefs, paramRefs } = collectReferences(tokens, symbols);
  const { inVars, outVars } = collectDatabus(tokens);
  return {
    tokens,
    symbols,
    global: globalDecls.concat(globalRefs),
    param: paramDecls.concat(paramRefs),
    inVars,
    outVars,
  };
}

module.exports = { tokenize, analyze };
