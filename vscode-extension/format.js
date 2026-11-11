'use strict';

const { tokenize } = require('./checker');

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

function formatText(text, options) {
  const settings = options || {};
  const indentUnit = settings.insertSpaces
    ? ' '.repeat(settings.tabSize || 4)
    : '\t';

  const lines = text.split(/\r?\n/);
  const starts = computeLineStarts(text);
  const info = lines.map(() => ({ opens: 0, closes: 0, leadingCloses: 0, onlyCloses: true }));

  const tokens = tokenize(text).filter((t) => t.type !== 'comment' && t.type !== 'string');
  for (const token of tokens) {
    const line = lineAt(starts, token.start);
    const entry = info[line];
    if (token.value === '}') {
      entry.closes++;
      if (entry.onlyCloses) entry.leadingCloses++;
    } else {
      entry.onlyCloses = false;
      if (token.value === '{') entry.opens++;
    }
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let level = 0;
  const formatted = lines.map((line, index) => {
    const entry = info[index];
    const indentLevel = Math.max(0, level - entry.leadingCloses);
    const content = line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    const rendered = content ? indentUnit.repeat(indentLevel) + content : '';
    level = Math.max(0, level + entry.opens - entry.closes);
    return rendered;
  });

  return formatted.join(eol);
}

module.exports = { formatText };
