'use strict';

const { tokenize } = require('./checker');

const BUILTIN_TYPES = new Set(['bool', 'integer', 'fractional', 'string', 'analogue']);

function matching(tokens, openIndex, open, close) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i].value === open) depth++;
    else if (tokens[i].value === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function nextValue(tokens, from, value) {
  for (let i = Math.max(0, from); i < tokens.length; i++) {
    if (tokens[i].value === value) return i;
  }
  return -1;
}

function buildModel(text) {
  const allTokens = tokenize(text);
  const tokens = allTokens.filter((t) => t.type !== 'comment');

  const rootScope = { start: 0, end: text.length, parent: null };
  const scopeStack = [rootScope];
  const declarations = [];
  const byName = new Map();
  const occurrences = [];
  const databus = [];
  const functions = new Map();
  const types = new Map();

  const currentScope = () => scopeStack[scopeStack.length - 1];

  const addDecl = (decl) => {
    declarations.push(decl);
    if (decl.name && !byName.has(decl.name)) byName.set(decl.name, decl);
    if (decl.kind === 'function') functions.set(decl.name, decl);
    if (decl.kind === 'type') types.set(decl.name, decl);
  };

  const addOccurrence = (name, token, role) => {
    occurrences.push({ name, start: token.start, end: token.end, role });
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.value === '{') {
      scopeStack.push({ start: token.end, end: text.length, parent: currentScope() });
      i++;
      continue;
    }
    if (token.value === '}') {
      if (scopeStack.length > 1) {
        const scope = scopeStack.pop();
        scope.end = token.start;
      }
      i++;
      continue;
    }
    if (token.type !== 'ident') {
      i++;
      continue;
    }

    if (token.value === 'define') {
      const keyword = tokens[i + 1];
      if (!keyword || keyword.type !== 'ident') {
        i++;
        continue;
      }

      if (keyword.value === 'var' || keyword.value === 'list') {
        const typeTok = tokens[i + 2];
        const nameTok = tokens[i + 3];
        if (typeTok && nameTok && typeTok.type === 'ident' && nameTok.type === 'ident') {
          const isList = keyword.value === 'list';
          const type = isList ? `list<${typeTok.value}>` : typeTok.value;
          const scope = currentScope();
          const decl = {
            name: nameTok.value,
            kind: scope === rootScope ? 'global' : 'local',
            type,
            nameStart: nameTok.start,
            nameEnd: nameTok.end,
            start: token.start,
            end: nameTok.end,
            scope,
          };
          addDecl(decl);
          addOccurrence(decl.name, nameTok, 'decl');
          if (!BUILTIN_TYPES.has(typeTok.value) && typeTok.value !== 'list') {
            addOccurrence(typeTok.value, typeTok, 'type');
          }
          i += 4;
          continue;
        }
      } else if (keyword.value === 'function') {
        const nameTok = tokens[i + 2];
        if (nameTok && nameTok.type === 'ident') {
          const open = tokens[i + 3] && tokens[i + 3].value === '(' ? i + 3 : -1;
          const close = open >= 0 ? matching(tokens, open, '(', ')') : -1;
          const bodyOpen = close >= 0 ? nextValue(tokens, close + 1, '{') : -1;
          const bodyClose = bodyOpen >= 0 ? matching(tokens, bodyOpen, '{', '}') : -1;
          const bodyScope = {
            start: bodyOpen >= 0 ? tokens[bodyOpen].end : nameTok.end,
            end: bodyClose >= 0 ? tokens[bodyClose].start : text.length,
            parent: rootScope,
          };
          const params = [];
          if (open >= 0 && close > open) {
            let k = open + 1;
            while (k < close) {
              const ptype = tokens[k];
              const pname = tokens[k + 1];
              if (ptype && pname && ptype.type === 'ident' && pname.type === 'ident') {
                const param = {
                  name: pname.value,
                  kind: 'param',
                  type: ptype.value,
                  nameStart: pname.start,
                  nameEnd: pname.end,
                  start: pname.start,
                  end: pname.end,
                  scope: bodyScope,
                };
                params.push(param);
                addDecl(param);
                addOccurrence(param.name, pname, 'decl');
                if (!BUILTIN_TYPES.has(ptype.value) && ptype.value !== 'list') {
                  addOccurrence(ptype.value, ptype, 'type');
                }
                k += 2;
              } else {
                k++;
              }
            }
          }
          const decl = {
            name: nameTok.value,
            kind: 'function',
            type: null,
            params,
            nameStart: nameTok.start,
            nameEnd: nameTok.end,
            start: token.start,
            end: bodyClose >= 0 ? tokens[bodyClose].end : nameTok.end,
            scope: rootScope,
          };
          addDecl(decl);
          addOccurrence(decl.name, nameTok, 'decl');
          i = close >= 0 ? close + 1 : i + 1;
          continue;
        }
      } else if (keyword.value === 'type') {
        const nameTok = tokens[i + 2];
        if (nameTok && nameTok.type === 'ident') {
          const bodyOpen = nextValue(tokens, i + 3, '{');
          const bodyClose = bodyOpen >= 0 ? matching(tokens, bodyOpen, '{', '}') : -1;
          const members = [];
          if (bodyOpen >= 0 && bodyClose > bodyOpen) {
            let k = bodyOpen;
            while (k < bodyClose) {
              if (tokens[k].value === 'define' && tokens[k + 1] && tokens[k + 1].value === 'member') {
                const mtype = tokens[k + 2];
                const mname = tokens[k + 3];
                if (mtype && mname && mtype.type === 'ident' && mname.type === 'ident') {
                  const member = {
                    name: mname.value,
                    kind: 'member',
                    type: mtype.value,
                    nameStart: mname.start,
                    nameEnd: mname.end,
                    start: mname.start,
                    end: mname.end,
                    scope: rootScope,
                  };
                  members.push(member);
                  addDecl(member);
                  addOccurrence(member.name, mname, 'decl');
                  if (!BUILTIN_TYPES.has(mtype.value) && mtype.value !== 'list') {
                    addOccurrence(mtype.value, mtype, 'type');
                  }
                  k += 4;
                  continue;
                }
              }
              k++;
            }
          }
          const decl = {
            name: nameTok.value,
            kind: 'type',
            type: null,
            members,
            nameStart: nameTok.start,
            nameEnd: nameTok.end,
            start: token.start,
            end: bodyClose >= 0 ? tokens[bodyClose].end : nameTok.end,
            scope: rootScope,
          };
          addDecl(decl);
          addOccurrence(decl.name, nameTok, 'decl');
          i = bodyClose >= 0 ? bodyClose + 1 : i + 1;
          continue;
        }
      } else if (keyword.value === 'member') {
        i += 4;
        continue;
      }

      i++;
      continue;
    }

    if (token.value === 'on_tick') {
      const bodyOpen = nextValue(tokens, i + 1, '{');
      const bodyClose = bodyOpen >= 0 ? matching(tokens, bodyOpen, '{', '}') : -1;
      const decl = {
        name: 'on_tick',
        kind: 'event',
        type: null,
        nameStart: token.start,
        nameEnd: token.end,
        start: token.start,
        end: bodyClose >= 0 ? tokens[bodyClose].end : token.end,
        scope: rootScope,
      };
      addDecl(decl);
      addOccurrence('on_tick', token, 'decl');
      i++;
      continue;
    }

    if (token.value === 'in' || token.value === 'out') {
      const first = tokens[i + 1];
      if (first && first.type === 'ident') {
        let last = first;
        let k = i + 2;
        while (tokens[k] && tokens[k].value === '.' && tokens[k + 1] && tokens[k + 1].type === 'ident') {
          last = tokens[k + 1];
          k += 2;
        }
        databus.push({ start: first.start, end: last.end });
        i = k;
        continue;
      }
      i++;
      continue;
    }

    if (token.value === 'var' || token.value === 'param') {
      const nameTok = tokens[i + 1];
      if (nameTok && nameTok.type === 'ident') {
        addOccurrence(nameTok.value, nameTok, token.value);
        const dot = tokens[i + 2];
        const member = tokens[i + 3];
        if (dot && dot.value === '.' && member && member.type === 'ident') {
          addOccurrence(member.value, member, 'member');
        }
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (token.value === 'call') {
      const nameTok = tokens[i + 1];
      if (nameTok && nameTok.type === 'ident') {
        addOccurrence(nameTok.value, nameTok, 'call');
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    i++;
  }

  for (const decl of declarations) {
    decl.scopeStart = decl.scope ? decl.scope.start : 0;
    decl.scopeEnd = decl.scope ? decl.scope.end : text.length;
  }

  for (const occurrence of occurrences) {
    occurrence.target = byName.get(occurrence.name) || null;
  }

  return {
    text,
    tokens,
    allTokens,
    declarations,
    byName,
    occurrences,
    databus,
    functions,
    types,
  };
}

const cache = new Map();

function getModel(document) {
  const key = document.uri.toString();
  const cached = cache.get(key);
  if (cached && cached.version === document.version) return cached.model;
  const model = buildModel(document.getText());
  cache.set(key, { version: document.version, model });
  return model;
}

function clearModel(uri) {
  cache.delete(uri.toString());
}

function isExcluded(model, offset) {
  for (const token of model.allTokens) {
    if (
      (token.type === 'comment' || token.type === 'string') &&
      token.start <= offset &&
      offset < token.end
    ) {
      return true;
    }
  }
  for (const path of model.databus) {
    if (path.start <= offset && offset < path.end) return true;
  }
  return false;
}

module.exports = { buildModel, getModel, clearModel, isExcluded, BUILTIN_TYPES };
