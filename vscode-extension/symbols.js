'use strict';

const { tokenize } = require('./analyzer');

function nextIndexOf(tokens, from, value) {
  for (let i = Math.max(0, from); i < tokens.length; i++) {
    if (tokens[i].value === value) return i;
  }
  return -1;
}

function findClosing(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    const value = tokens[i].value;
    if (value === '{') depth++;
    else if (value === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function matchingParen(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i].value === '(') depth++;
    else if (tokens[i].value === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tokenSymbol(token, detail, kind) {
  return {
    name: token.value,
    detail,
    kind,
    start: token.start,
    end: token.end,
    selectionStart: token.start,
    selectionEnd: token.end,
  };
}

function functionChildren(tokens, openParen, closeParen) {
  const children = [];
  if (openParen < 0 || closeParen <= openParen) return children;
  let i = openParen + 1;
  while (i < closeParen) {
    const typeTok = tokens[i];
    const nameTok = tokens[i + 1];
    if (typeTok && nameTok && typeTok.type === 'ident' && nameTok.type === 'ident') {
      children.push(tokenSymbol(nameTok, typeTok.value, 'param'));
      i += 2;
    } else {
      i++;
    }
  }
  return children;
}

function typeChildren(tokens, openBrace, closeBrace) {
  const children = [];
  if (openBrace < 0 || closeBrace <= openBrace) return children;
  let i = openBrace;
  while (i < closeBrace) {
    if (
      tokens[i].value === 'define' &&
      tokens[i + 1] &&
      tokens[i + 1].value === 'member'
    ) {
      const typeTok = tokens[i + 2];
      const nameTok = tokens[i + 3];
      if (typeTok && nameTok && typeTok.type === 'ident' && nameTok.type === 'ident') {
        children.push(tokenSymbol(nameTok, typeTok.value, 'member'));
        i += 4;
        continue;
      }
    }
    i++;
  }
  return children;
}

function documentSymbols(text) {
  const tokens = tokenize(text).filter((t) => t.type !== 'comment');
  const symbols = [];
  let depth = 0;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token.value === '{') {
      depth++;
      i++;
      continue;
    }
    if (token.value === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth !== 0 || token.type !== 'ident') {
      i++;
      continue;
    }

    if (token.value === 'on_tick') {
      const openBrace = nextIndexOf(tokens, i + 1, '{');
      const closeBrace = openBrace >= 0 ? findClosing(tokens, openBrace) : -1;
      symbols.push({
        name: 'on_tick',
        detail: 'entrypoint',
        kind: 'event',
        start: token.start,
        end: closeBrace >= 0 ? tokens[closeBrace].end : token.end,
        selectionStart: token.start,
        selectionEnd: token.end,
      });
      i++;
      continue;
    }

    if (token.value !== 'define') {
      i++;
      continue;
    }

    const keyword = tokens[i + 1];
    if (!keyword) {
      i++;
      continue;
    }

    if (keyword.value === 'var' || keyword.value === 'list') {
      const typeTok = tokens[i + 2];
      const nameTok = tokens[i + 3];
      if (typeTok && nameTok && typeTok.type === 'ident' && nameTok.type === 'ident') {
        const detail = keyword.value === 'list' ? `list<${typeTok.value}>` : typeTok.value;
        const symbol = tokenSymbol(nameTok, detail, 'variable');
        symbol.start = token.start;
        symbols.push(symbol);
      }
      i += 4;
      continue;
    }

    if (keyword.value === 'function') {
      const nameTok = tokens[i + 2];
      if (nameTok && nameTok.type === 'ident') {
        const openParen = nextIndexOf(tokens, i + 3, '(');
        const closeParen = openParen >= 0 ? matchingParen(tokens, openParen) : -1;
        const openBrace = nextIndexOf(tokens, (closeParen >= 0 ? closeParen : i) + 1, '{');
        const closeBrace = openBrace >= 0 ? findClosing(tokens, openBrace) : -1;
        const symbol = tokenSymbol(nameTok, 'function', 'function');
        symbol.start = token.start;
        symbol.end = closeBrace >= 0 ? tokens[closeBrace].end : nameTok.end;
        symbol.children = functionChildren(tokens, openParen, closeParen);
        symbols.push(symbol);
        i = closeBrace >= 0 ? closeBrace + 1 : i + 1;
        continue;
      }
    }

    if (keyword.value === 'type') {
      const nameTok = tokens[i + 2];
      if (nameTok && nameTok.type === 'ident') {
        const openBrace = nextIndexOf(tokens, i + 3, '{');
        const closeBrace = openBrace >= 0 ? findClosing(tokens, openBrace) : -1;
        const symbol = tokenSymbol(nameTok, 'type', 'type');
        symbol.start = token.start;
        symbol.end = closeBrace >= 0 ? tokens[closeBrace].end : nameTok.end;
        symbol.children = typeChildren(tokens, openBrace, closeBrace);
        symbols.push(symbol);
        i = closeBrace >= 0 ? closeBrace + 1 : i + 1;
        continue;
      }
    }

    i++;
  }

  return symbols;
}

module.exports = { documentSymbols };
