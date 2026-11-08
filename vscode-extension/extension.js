'use strict';

const vscode = require('vscode');
const { analyze } = require('./analyzer');
const { check } = require('./checker');
const { documentSymbols } = require('./symbols');
const { foldingRanges } = require('./folding');
const { lookupHover } = require('./hover');
const { registerIntellisense } = require('./intellisense');
const { getModel, isExcluded, databusContextAt } = require('./model');
const { loadSchema, clearSchema } = require('./databus');
const { getConstants, clearConstants } = require('./constants');

const SYMBOL_KINDS = {
  function: vscode.SymbolKind.Function,
  type: vscode.SymbolKind.Struct,
  variable: vscode.SymbolKind.Variable,
  event: vscode.SymbolKind.Event,
  param: vscode.SymbolKind.Variable,
  member: vscode.SymbolKind.Field,
};

let globalType;
let paramType;
let inType;
let outType;
let diagnostics;
const timers = new Map();
const checked = new Map();

function palette() {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === vscode.ColorThemeKind.Light) {
    return { global: '#B76E00', param: '#AF00DB', in: '#0F7B6C', out: '#1A7F37' };
  }
  if (kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight) {
    return { global: '#FFD700', param: '#D670D6', in: '#4FE0C6', out: '#7EE787' };
  }
  return { global: '#E5C07B', param: '#C586C0', in: '#4EC9B0', out: '#7EE787' };
}

function rebuildTypes() {
  if (globalType) globalType.dispose();
  if (paramType) paramType.dispose();
  if (inType) inType.dispose();
  if (outType) outType.dispose();
  const colors = palette();
  globalType = vscode.window.createTextEditorDecorationType({ color: colors.global });
  paramType = vscode.window.createTextEditorDecorationType({ color: colors.param });
  inType = vscode.window.createTextEditorDecorationType({ color: colors.in });
  outType = vscode.window.createTextEditorDecorationType({ color: colors.out });
}

function toRanges(document, tokens) {
  return tokens.map((token) =>
    new vscode.Range(document.positionAt(token.start), document.positionAt(token.end))
  );
}

function updateEditor(editor) {
  if (!editor || editor.document.languageId !== 'anymaker') return;
  if (!globalType) rebuildTypes();
  let result;
  try {
    result = analyze(editor.document.getText());
  } catch (error) {
    return;
  }
  editor.setDecorations(globalType, toRanges(editor.document, result.global));
  editor.setDecorations(paramType, toRanges(editor.document, result.param));
  editor.setDecorations(inType, toRanges(editor.document, result.inVars));
  editor.setDecorations(outType, toRanges(editor.document, result.outVars));
}

async function refreshDiagnostics(document) {
  if (!diagnostics) return;
  const key = document.uri.toString();
  if (document.languageId !== 'anymaker') {
    diagnostics.delete(document.uri);
    checked.delete(key);
    return;
  }
  const version = document.version;
  const schema = await loadSchema(document);
  if (document.version !== version) return;
  let result;
  try {
    result = check(document.getText(), schema);
  } catch (error) {
    return;
  }
  checked.set(key, result);
  const items = result.map((item) => {
    const range = new vscode.Range(document.positionAt(item.start), document.positionAt(item.end));
    const severity =
      item.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(range, item.message, severity);
    diagnostic.source = 'anymaker';
    return diagnostic;
  });
  diagnostics.set(document.uri, items);
}

function refresh(document) {
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === document) updateEditor(editor);
  }
  refreshDiagnostics(document);
}

function handleSchemaFile(uri) {
  if (!/\.json$/i.test(uri.path)) return;
  clearSchema(uri);
  const amcUri = uri.with({ path: uri.path.replace(/\.json$/i, '.amc') });
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.toString() === amcUri.toString()) refreshDiagnostics(document);
  }
}

function toDocumentSymbol(document, symbol) {
  const range = new vscode.Range(document.positionAt(symbol.start), document.positionAt(symbol.end));
  const selection = new vscode.Range(
    document.positionAt(symbol.selectionStart),
    document.positionAt(symbol.selectionEnd)
  );
  const result = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail || '',
    SYMBOL_KINDS[symbol.kind] || vscode.SymbolKind.Variable,
    range,
    selection
  );
  if (symbol.children && symbol.children.length) {
    result.children = symbol.children.map((child) => toDocumentSymbol(document, child));
  }
  return result;
}

function symbolHover(decl) {
  switch (decl.kind) {
    case 'function': {
      const params = (decl.params || []).map((param) => `${param.type} ${param.name}`).join(', ');
      return { label: 'function', code: `define function ${decl.name} (${params})` };
    }
    case 'type': {
      const members = (decl.members || []).map((member) => `\t${member.type} ${member.name}`).join('\n');
      return { label: 'type', code: `define type ${decl.name}\n{\n${members}\n}` };
    }
    case 'global':
    case 'local': {
      const label = decl.kind === 'global' ? 'global variable' : 'local variable';
      if (decl.type && decl.type.startsWith('list<') && decl.type.endsWith('>')) {
        const element = decl.type.slice(5, -1);
        return { label, type: decl.type, code: `define list ${element} ${decl.name}` };
      }
      return { label, type: decl.type, code: `define var ${decl.type} ${decl.name}` };
    }
    case 'param':
      return { label: 'parameter', type: decl.type, code: `param ${decl.type} ${decl.name}` };
    case 'member':
      return { label: 'member', type: decl.type, code: `define member ${decl.type} ${decl.name}` };
    case 'event':
      return { label: 'entrypoint', code: 'on_tick' };
    default:
      return { label: decl.kind, code: decl.name };
  }
}

function commentAbove(document, decl) {
  if (!decl || decl.kind === 'param') return [];
  const startLine = document.positionAt(decl.start).line;
  const comments = [];
  for (let line = startLine - 1; line >= 0; line--) {
    const text = document.lineAt(line).text;
    if (!/^\s*#/.test(text)) break;
    comments.unshift(text.replace(/^\s*#\s?/, ''));
  }
  return comments;
}

async function provideDatabusHover(document, context) {
  const schema = await loadSchema(document);
  const entry = schema && schema[context.direction] && schema[context.direction][context.path];
  const type = entry && entry.type ? entry.type : 'unknown';
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**databus ${context.direction}** · \`${type}\`\n\n`);
  markdown.appendCodeblock(`${context.direction} ${context.path}`, 'anymaker');
  if (entry && entry.description) {
    markdown.appendMarkdown('\n\n');
    markdown.appendText(entry.description);
  } else if (!schema) {
    const base = document.uri.path.split('/').pop().replace(/\.amc$/i, '.json');
    markdown.appendMarkdown(`\n\nNo matching \`${base}\` databus schema found.`);
  } else {
    markdown.appendMarkdown(`\n\nUnknown databus '${context.direction}' path.`);
  }
  const range = new vscode.Range(document.positionAt(context.start), document.positionAt(context.end));
  return new vscode.Hover(markdown, range);
}

async function provideHover(document, position) {
  const model = getModel(document);
  const offset = document.offsetAt(position);
  const databus = databusContextAt(model, offset);
  if (databus && databus.inPath) {
    return provideDatabusHover(document, databus);
  }

  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!range) return null;
  const word = document.getText(range);
  const wordOffset = document.offsetAt(range.start);
  const decl = isExcluded(model, wordOffset) ? null : model.byName.get(word) || null;
  const info = lookupHover(word);
  if (!decl && !info) return null;

  const markdown = new vscode.MarkdownString();
  if (decl) {
    const view = symbolHover(decl);
    const label = view.type ? `**${view.label}** · \`${view.type}\`` : `**${view.label}**`;
    markdown.appendMarkdown(`${label}\n\n`);
    markdown.appendCodeblock(view.code, 'anymaker');
    if (decl.kind === 'global') {
      const constant = getConstants(document).get(decl.name);
      if (constant) {
        markdown.appendMarkdown(`\n\n**Value:** \`${constant.display}\``);
      }
    }
    const comments = commentAbove(document, decl);
    for (const comment of comments) {
      markdown.appendMarkdown('\n\n');
      markdown.appendText(comment);
    }
  }
  if (info) {
    if (decl) markdown.appendMarkdown('\n---\n');
    if (info.signature) markdown.appendCodeblock(info.signature, 'anymaker');
    if (info.description) markdown.appendMarkdown(info.description);
  }
  return new vscode.Hover(markdown, range);
}

function provideFoldingRanges(document) {
  try {
    return foldingRanges(document.getText()).map((range) => {
      const kind =
        range.kind === 'comment' ? vscode.FoldingRangeKind.Comment : vscode.FoldingRangeKind.Region;
      return new vscode.FoldingRange(range.startLine, range.endLine, kind);
    });
  } catch (error) {
    return [];
  }
}

function provideCodeActions(document, range, context) {
  const items = checked.get(document.uri.toString());
  if (!items) return [];
  const actions = [];
  for (const diagnostic of context.diagnostics) {
    if (diagnostic.source !== 'anymaker') continue;
    const offset = document.offsetAt(diagnostic.range.start);
    const item = items.find((candidate) => candidate.start === offset && candidate.message === diagnostic.message);
    if (!item || !item.fix) continue;
    const action = new vscode.CodeAction(item.fix.title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    const edit = new vscode.WorkspaceEdit();
    for (const change of item.fix.edits) {
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)),
        change.newText
      );
    }
    action.edit = edit;
    actions.push(action);
  }
  return actions;
}

function updateVisible() {
  for (const editor of vscode.window.visibleTextEditors) updateEditor(editor);
}

function schedule(document) {
  if (document.languageId !== 'anymaker') return;
  const key = document.uri.toString();
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      refresh(document);
    }, 100)
  );
}

function activate(context) {
  diagnostics = vscode.languages.createDiagnosticCollection('anymaker');
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(...registerIntellisense());

  rebuildTypes();
  for (const document of vscode.workspace.textDocuments) refreshDiagnostics(document);
  updateVisible();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      schedule(event.document);
      if (/\.json$/i.test(event.document.uri.path)) handleSchemaFile(event.document.uri);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => handleSchemaFile(document.uri)),
    vscode.workspace.onDidCreateFiles((event) => event.files.forEach(handleSchemaFile)),
    vscode.workspace.onDidDeleteFiles((event) => event.files.forEach(handleSchemaFile)),
    vscode.workspace.onDidRenameFiles((event) =>
      event.files.forEach((file) => {
        handleSchemaFile(file.oldUri);
        handleSchemaFile(file.newUri);
      })
    ),
    vscode.workspace.onDidOpenTextDocument((document) => refresh(document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      checked.delete(document.uri.toString());
      clearConstants(document.uri);
    }),
    vscode.languages.registerCodeActionsProvider(
      'anymaker',
      { provideCodeActions },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.languages.registerDocumentSymbolProvider('anymaker', {
      provideDocumentSymbols(document) {
        try {
          return documentSymbols(document.getText()).map((symbol) => toDocumentSymbol(document, symbol));
        } catch (error) {
          return [];
        }
      },
    }),
    vscode.languages.registerHoverProvider('anymaker', { provideHover }),
    vscode.languages.registerFoldingRangeProvider('anymaker', { provideFoldingRanges }),
    vscode.window.onDidChangeVisibleTextEditors(() => updateVisible()),
    vscode.window.onDidChangeActiveTextEditor((editor) => updateEditor(editor)),
    vscode.window.onDidChangeActiveColorTheme(() => {
      rebuildTypes();
      updateVisible();
    }),
    {
      dispose() {
        if (globalType) globalType.dispose();
        if (paramType) paramType.dispose();
        if (inType) inType.dispose();
        if (outType) outType.dispose();
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      },
    }
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
