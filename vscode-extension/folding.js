'use strict';

const { tokenize } = require('./analyzer');
const { documentSymbols } = require('./symbols');

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function braceRanges(tokens, starts) {
  const ranges = [];
  const stack = [];
  for (const token of tokens) {
    if (token.value === '{') {
      stack.push(token);
    } else if (token.value === '}') {
      const open = stack.pop();
      if (!open) continue;
      const startLine = lineAt(starts, open.start);
      const endLine = lineAt(starts, Math.max(open.start, token.start));
      if (endLine > startLine) ranges.push({ startLine, endLine, kind: 'region' });
    }
  }
  return ranges;
}

function commentRanges(text) {
  const lines = text.split(/\r?\n/);
  const ranges = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const isComment = /^\s*#/.test(lines[i]);
    if (isComment && start < 0) {
      start = i;
    } else if (!isComment && start >= 0) {
      if (i - 1 > start) ranges.push({ startLine: start, endLine: i - 1, kind: 'comment' });
      start = -1;
    }
  }
  if (start >= 0 && lines.length - 1 > start) {
    ranges.push({ startLine: start, endLine: lines.length - 1, kind: 'comment' });
  }
  return ranges;
}

function symbolRanges(text, starts) {
  const ranges = [];
  const seen = new Set();
  const walk = (list) => {
    for (const symbol of list) {
      if (
        (symbol.kind === 'function' || symbol.kind === 'type' || symbol.kind === 'event') &&
        symbol.end > symbol.start
      ) {
        const startLine = lineAt(starts, symbol.start);
        const endLine = lineAt(starts, Math.max(symbol.start, symbol.end - 1));
        if (endLine > startLine) {
          const key = `${startLine}:${endLine}`;
          if (!seen.has(key)) {
            seen.add(key);
            ranges.push({ startLine, endLine, kind: 'region' });
          }
        }
      }
      if (symbol.children) walk(symbol.children);
    }
  };
  walk(documentSymbols(text));
  return ranges;
}

function foldingRanges(text) {
  const starts = computeLineStarts(text);
  const tokens = tokenize(text).filter((t) => t.type !== 'comment' && t.type !== 'string');

  const symbols = symbolRanges(text, starts);
  const symbolEndLines = new Set(symbols.map((r) => r.endLine));
  const symbolStartLines = new Set(symbols.map((r) => r.startLine));

  const result = [...symbols];
  const seen = new Set(symbols.map((r) => `${r.startLine}:${r.endLine}`));

  for (const range of braceRanges(tokens, starts)) {
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) continue;
    if (symbolEndLines.has(range.endLine) && !symbolStartLines.has(range.startLine)) {
      continue;
    }
    seen.add(key);
    result.push(range);
  }

  for (const range of commentRanges(text)) {
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(range);
  }

  result.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  return result;
}

module.exports = { foldingRanges };
