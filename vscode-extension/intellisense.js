'use strict';

const vscode = require('vscode');
const { getModel, clearModel, isExcluded } = require('./model');
const { lookupHover, builtinSignature, BUILTINS } = require('./hover');
const { RESERVED } = require('./checker');

const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const KEYWORDS = [
  'define', 'var', 'param', 'call', 'if', 'elseif', 'else', 'repeat',
  'contains', 'true', 'false', 'list', 'type', 'member', 'function',
  'in', 'out', 'on_tick',
];
const DECL_KEYWORDS = ['var', 'list', 'type', 'member', 'function'];

function lastToken(tokens, anchor) {
  let result = null;
  let index = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start >= anchor) break;
    result = tokens[i];
    index = i;
  }
  return { token: result, index };
}

function openParenBefore(tokens, offset) {
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.start >= offset) break;
    if (token.value === '(') stack.push({ index: i, token });
    else if (token.value === ')') stack.pop();
  }
  return stack.length ? stack[stack.length - 1] : null;
}

function activeParameter(tokens, openIndex, offset) {
  let depth = 0;
  let commas = 0;
  for (let i = openIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.start >= offset) break;
    if (token.value === '(') depth++;
    else if (token.value === ')') {
      if (depth === 0) break;
      depth--;
    } else if (token.value === ',' && depth === 0) {
      commas++;
    }
  }
  return commas;
}

function scopeContains(decl, offset) {
  if (decl.kind === 'global' || decl.kind === 'function' || decl.kind === 'type' || decl.kind === 'member') {
    return true;
  }
  return decl.scopeStart <= offset && offset <= decl.scopeEnd;
}

function declKind(decl) {
  switch (decl.kind) {
    case 'function':
      return vscode.CompletionItemKind.Function;
    case 'type':
      return vscode.CompletionItemKind.Struct;
    case 'member':
      return vscode.CompletionItemKind.Field;
    default:
      return vscode.CompletionItemKind.Variable;
  }
}

function signatureTypeContext(model, anchor) {
  const open = openParenBefore(model.tokens, anchor);
  if (!open) return null;
  const nameTok = model.tokens[open.index - 1];
  const keyword = model.tokens[open.index - 2];
  const defineTok = model.tokens[open.index - 3];
  if (!(nameTok && keyword && defineTok && keyword.value === 'function' && defineTok.value === 'define')) {
    return null;
  }
  let idents = 0;
  for (let i = open.index + 1; i < model.tokens.length; i++) {
    const token = model.tokens[i];
    if (token.start >= anchor) break;
    if (token.value === ',') idents = 0;
    else if (token.type === 'ident') idents++;
  }
  if (idents === 0) return { kind: 'type', declKeyword: 'member' };
  return null;
}

function completionContext(model, anchor) {
  const { token, index } = lastToken(model.tokens, anchor);
  if (!token) return { kind: 'generic' };
  const previous = index > 0 ? model.tokens[index - 1] : null;

  if (token.value === '.') {
    const base = index > 0 ? model.tokens[index - 1] : null;
    if (base && base.type === 'ident') {
      const decl = model.byName.get(base.value);
      if (decl && decl.type) {
        const typeDecl = model.types.get(decl.type);
        if (typeDecl) return { kind: 'members', members: typeDecl.members || [] };
      }
    }
    return { kind: 'members', members: [] };
  }

  if (token.value === 'define') return { kind: 'decl' };

  if (token.value === 'var' || token.value === 'list' || token.value === 'member') {
    if (previous && previous.value === 'define') return { kind: 'type', declKeyword: token.value };
    if (token.value === 'var') return { kind: 'variables' };
  }

  if (token.value === 'param') return { kind: 'params' };
  if (token.value === 'call') return { kind: 'functions' };
  if (token.value === 'in' || token.value === 'out') return { kind: 'databus' };

  const signature = signatureTypeContext(model, anchor);
  if (signature) return signature;

  return { kind: 'generic' };
}

function completionItems(model, offset, context) {
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const key = `${item.label}|${item.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  const addKeywords = () => {
    for (const word of KEYWORDS) {
      const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
      const info = lookupHover(word);
      if (info && info.description) item.documentation = new vscode.MarkdownString(info.description);
      add(item);
    }
  };

  const addDeclKeywords = () => {
    for (const word of DECL_KEYWORDS) {
      add(new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword));
    }
  };

  const addTypes = (declKeyword) => {
    const allowed = new Set(['bool', 'integer', 'fractional', 'string', 'analogue']);
    if (declKeyword === 'list') {
      allowed.delete('string');
      allowed.delete('analogue');
    }
    for (const name of allowed) {
      add(new vscode.CompletionItem(name, vscode.CompletionItemKind.TypeParameter));
    }
    for (const name of model.types.keys()) {
      add(new vscode.CompletionItem(name, vscode.CompletionItemKind.Struct));
    }
  };

  const addSymbols = (filter) => {
    for (const decl of model.declarations) {
      if (decl.kind === 'event') continue;
      if (filter && !filter(decl)) continue;
      if (!scopeContains(decl, offset)) continue;
      const item = new vscode.CompletionItem(decl.name, declKind(decl));
      if (decl.type) item.detail = decl.type;
      add(item);
    }
  };

  const addBuiltins = () => {
    for (const name of BUILTINS.keys()) {
      const info = builtinSignature(name);
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      if (info) {
        item.detail = info.label;
        item.documentation = new vscode.MarkdownString(info.documentation);
      }
      add(item);
    }
  };

  const addMembers = (members) => {
    for (const member of members) {
      const item = new vscode.CompletionItem(member.name, vscode.CompletionItemKind.Field);
      if (member.type) item.detail = member.type;
      add(item);
    }
  };

  switch (context.kind) {
    case 'decl':
      addDeclKeywords();
      break;
    case 'type':
      addTypes(context.declKeyword);
      break;
    case 'variables':
      addSymbols((decl) => decl.kind === 'global' || decl.kind === 'local');
      break;
    case 'params':
      addSymbols((decl) => decl.kind === 'param');
      break;
    case 'functions':
      addSymbols((decl) => decl.kind === 'function');
      break;
    case 'members':
      addMembers(context.members);
      break;
    case 'databus':
      break;
    default:
      addKeywords();
      addTypes();
      addBuiltins();
      addSymbols((decl) => decl.kind !== 'member');
  }

  return items;
}

function provideCompletionItems(document, position) {
  const model = getModel(document);
  const offset = document.offsetAt(position);
  if (isExcluded(model, offset)) return undefined;
  const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
  const anchor = wordRange ? document.offsetAt(wordRange.start) : offset;
  const context = completionContext(model, anchor);
  return new vscode.CompletionList(completionItems(model, offset, context), false);
}

function provideSignatureHelp(document, position) {
  const model = getModel(document);
  const offset = document.offsetAt(position);
  const open = openParenBefore(model.tokens, offset);
  if (!open) return null;
  const nameTok = model.tokens[open.index - 1];
  const previous = model.tokens[open.index - 2];
  if (!nameTok || nameTok.type !== 'ident') return null;

  let label = '';
  let parameters = [];
  let documentation = '';

  if (previous && previous.value === 'call') {
    const fn = model.functions.get(nameTok.value);
    if (!fn) return null;
    label = `${fn.name} (${fn.params.map((p) => `${p.type} ${p.name}`).join(', ')})`;
    parameters = fn.params.map((p) => ({ label: `${p.type} ${p.name}`, documentation: '' }));
    documentation = 'User-defined function';
  } else if (previous && previous.value === 'function') {
    const fn = model.functions.get(nameTok.value);
    if (!fn) return null;
    label = `${fn.name} (${fn.params.map((p) => `${p.type} ${p.name}`).join(', ')})`;
    parameters = fn.params.map((p) => ({ label: `${p.type} ${p.name}`, documentation: '' }));
    documentation = 'Function being defined';
  } else {
    const builtin = builtinSignature(nameTok.value);
    if (!builtin) return null;
    label = builtin.label;
    parameters = builtin.parameters;
    documentation = builtin.documentation;
  }

  const signature = new vscode.SignatureInformation(label, documentation);
  signature.parameters = parameters.map(
    (param) => new vscode.ParameterInformation(param.label, param.documentation)
  );
  const help = new vscode.SignatureHelp();
  help.signatures = [signature];
  help.activeSignature = 0;
  help.activeParameter = Math.min(
    activeParameter(model.tokens, open.index, offset),
    Math.max(parameters.length - 1, 0)
  );
  return help;
}

function symbolAt(model, document, position) {
  const range = document.getWordRangeAtPosition(position, WORD_RE);
  if (!range) return null;
  const offset = document.offsetAt(range.start);
  if (isExcluded(model, offset)) return null;
  const token = model.allTokens.find((t) => t.start === offset && t.type === 'ident');
  if (!token) return null;
  const decl = model.byName.get(token.value);
  if (!decl) return null;
  return { token, decl, range, word: token.value };
}

function provideDefinition(document, position) {
  const model = getModel(document);
  const found = symbolAt(model, document, position);
  if (!found) return null;
  return new vscode.Location(
    document.uri,
    new vscode.Range(document.positionAt(found.decl.nameStart), document.positionAt(found.decl.nameEnd))
  );
}

function provideReferences(document, position, context) {
  const model = getModel(document);
  const found = symbolAt(model, document, position);
  if (!found) return null;
  const seen = new Set();
  const locations = [];
  for (const occurrence of model.occurrences) {
    if (occurrence.name !== found.word) continue;
    if (!context.includeDeclaration && occurrence.role === 'decl') continue;
    const key = `${occurrence.start}:${occurrence.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(
      new vscode.Location(
        document.uri,
        new vscode.Range(document.positionAt(occurrence.start), document.positionAt(occurrence.end))
      )
    );
  }
  return locations;
}

function prepareRename(document, position) {
  const model = getModel(document);
  const found = symbolAt(model, document, position);
  if (!found) return null;
  if (found.decl.kind === 'event' || RESERVED.has(found.word)) return null;
  return { range: found.range, placeholder: found.word };
}

function provideRenameEdits(document, position, newName) {
  const model = getModel(document);
  const found = symbolAt(model, document, position);
  if (!found) return null;
  if (found.decl.kind === 'event' || RESERVED.has(found.word)) {
    throw new Error('This symbol cannot be renamed');
  }
  if (!NAME_RE.test(newName)) throw new Error(`'${newName}' is not a valid name`);
  if (RESERVED.has(newName)) throw new Error(`'${newName}' is a reserved keyword`);
  if (model.byName.has(newName) && newName !== found.word) {
    throw new Error(`'${newName}' is already declared`);
  }
  const edit = new vscode.WorkspaceEdit();
  let count = 0;
  for (const occurrence of model.occurrences) {
    if (occurrence.name !== found.word) continue;
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(occurrence.start), document.positionAt(occurrence.end)),
      newName
    );
    count++;
  }
  return count ? edit : null;
}

function registerIntellisense() {
  return [
    vscode.languages.registerCompletionItemProvider('anymaker', { provideCompletionItems }, '.'),
    vscode.languages.registerSignatureHelpProvider('anymaker', { provideSignatureHelp }, '(', ','),
    vscode.languages.registerDefinitionProvider('anymaker', { provideDefinition }),
    vscode.languages.registerReferenceProvider('anymaker', { provideReferences }),
    vscode.languages.registerRenameProvider('anymaker', { prepareRename, provideRenameEdits }),
    vscode.workspace.onDidCloseTextDocument((document) => clearModel(document.uri)),
  ];
}

module.exports = { registerIntellisense };
