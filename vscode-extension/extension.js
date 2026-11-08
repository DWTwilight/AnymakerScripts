'use strict';

const vscode = require('vscode');
const { analyze } = require('./analyzer');
const { check } = require('./checker');
const { documentSymbols } = require('./symbols');
const { foldingRanges } = require('./folding');
const { lookupHover } = require('./hover');

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

function refreshDiagnostics(document) {
  if (!diagnostics) return;
  const key = document.uri.toString();
  if (document.languageId !== 'anymaker') {
    diagnostics.delete(document.uri);
    checked.delete(key);
    return;
  }
  let result;
  try {
    result = check(document.getText());
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
  refreshDiagnostics(document);
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === document) updateEditor(editor);
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

function findSymbol(symbols, name) {
  for (const symbol of symbols) {
    if (symbol.name === name) return symbol;
    if (symbol.children) {
      const found = findSymbol(symbol.children, name);
      if (found) return found;
    }
  }
  return null;
}

function symbolDeclaration(symbol) {
  const detail = symbol.detail ? `${symbol.detail} ` : '';
  switch (symbol.kind) {
    case 'function':
      return `define function ${symbol.name} (...)`;
    case 'type':
      return `define type ${symbol.name}`;
    case 'variable':
      return `define var ${detail}${symbol.name}`;
    case 'event':
      return 'on_tick';
    case 'param':
      return `param ${detail}${symbol.name}`;
    case 'member':
      return `define member ${detail}${symbol.name}`;
    default:
      return `${detail}${symbol.name}`;
  }
}

function provideHover(document, position) {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!range) return null;
  const word = document.getText(range);
  let symbol = null;
  try {
    symbol = findSymbol(documentSymbols(document.getText()), word);
  } catch (error) {
    symbol = null;
  }
  const info = lookupHover(word);
  if (!symbol && !info) return null;
  const markdown = new vscode.MarkdownString();
  if (symbol) {
    markdown.appendCodeblock(symbolDeclaration(symbol), 'amc');
  }
  if (info) {
    if (symbol) markdown.appendMarkdown('\n---\n');
    if (info.signature) markdown.appendCodeblock(info.signature, 'amc');
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

  rebuildTypes();
  for (const document of vscode.workspace.textDocuments) refreshDiagnostics(document);
  updateVisible();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidOpenTextDocument((document) => refresh(document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnostics.delete(document.uri);
      checked.delete(document.uri.toString());
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
