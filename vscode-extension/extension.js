'use strict';

const vscode = require('vscode');
const { analyze } = require('./analyzer');

let globalType;
let paramType;
let inType;
let outType;
const timers = new Map();

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
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) updateEditor(editor);
      }
    }, 100)
  );
}

function activate(context) {
  rebuildTypes();
  updateVisible();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidOpenTextDocument((document) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) updateEditor(editor);
      }
    }),
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
