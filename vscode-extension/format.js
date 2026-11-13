'use strict';

const { tokenize } = require('./checker');

const OPERATORS = new Set([
  '=', '==', '>', '<', '>=', '<=', '&&', '||', '+', '-', '*', '/', '%', '^',
]);
const UNARY_PREDECESSORS = new Set([
  '(', '[', ',', '=', '==', '>', '<', '>=', '<=', '&&', '||', '+', '-', '*', '/',
  '%', '^', '!',
]);
const NO_SPACE_BEFORE = new Set([',', ')', ']', '.', ';']);

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

function isOperator(value) {
  return OPERATORS.has(value);
}

function separator(previous, current, previousUnary, currentUnary) {
  if (previousUnary) return '';
  if (currentUnary) {
    if (previous.value === '(' || previous.value === '[' || previous.value === '.') return '';
    return ' ';
  }
  if (NO_SPACE_BEFORE.has(current.value)) return '';
  if (previous.value === '(' || previous.value === '[' || previous.value === '.') return '';
  if (previous.value === ',') return ' ';
  if (current.value === '[') return '';
  if (current.value === '(') {
    if (
      previous.type === 'ident' ||
      previous.value === '!' ||
      isOperator(previous.value) ||
      previous.value === ')' ||
      previous.value === ']'
    ) {
      return ' ';
    }
    return '';
  }
  if (current.value === '!') {
    if (previous.value === '(' || previous.value === '[' || previous.value === '.') return '';
    return ' ';
  }
  if (previous.value === '!') return ' ';
  return ' ';
}

function normalizeTokens(tokens) {
  if (!tokens.length) return '';

  const unary = new Array(tokens.length).fill(false);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'punct' || (token.value !== '-' && token.value !== '+')) continue;
    const previous = i > 0 ? tokens[i - 1] : null;
    unary[i] = !previous || UNARY_PREDECESSORS.has(previous.value);
  }

  let output = tokens[0].value;
  for (let i = 1; i < tokens.length; i++) {
    output +=
      separator(tokens[i - 1], tokens[i], unary[i - 1], unary[i]) + tokens[i].value;
  }
  return output.replace(/[ \t]+$/, '');
}

function formatText(text, options) {
  const settings = options || {};
  const indentUnit = settings.insertSpaces ? ' '.repeat(settings.tabSize || 4) : '\t';

  const lines = text.split(/\r?\n/);
  const starts = computeLineStarts(text);
  const tokensByLine = lines.map(() => []);
  for (const token of tokenize(text)) {
    tokensByLine[lineAt(starts, token.start)].push(token);
  }

  const logical = [];
  for (const tokens of tokensByLine) {
    if (!tokens.length) {
      logical.push([]);
      continue;
    }

    let segment = [];
    for (const token of tokens) {
      if (token.type === 'punct' && (token.value === '{' || token.value === '}')) {
        if (segment.length) {
          logical.push(segment);
          segment = [];
        }
        logical.push([token]);
      } else {
        segment.push(token);
      }
    }
    if (segment.length) logical.push(segment);
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let level = 0;
  const formatted = logical.map((tokens) => {
    const content = normalizeTokens(tokens);

    let opens = 0;
    let closes = 0;
    for (const token of tokens) {
      if (token.type !== 'punct') continue;
      if (token.value === '{') opens++;
      else if (token.value === '}') closes++;
    }

    const leadingCloses =
      tokens.length > 0 && tokens[0].type === 'punct' && tokens[0].value === '}' ? 1 : 0;
    const indentLevel = Math.max(0, level - leadingCloses);
    const rendered = content ? indentUnit.repeat(indentLevel) + content : '';
    level = Math.max(0, level + opens - closes);
    return rendered;
  });

  return formatted.join(eol);
}

module.exports = { formatText };
