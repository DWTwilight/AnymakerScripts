'use strict';

const vscode = require('vscode');

const cache = new Map();

function schemaUriFor(document) {
  const path = document.uri.path;
  if (!/\.amc$/i.test(path)) return null;
  return document.uri.with({ path: path.replace(/\.amc$/i, '.json') });
}

function normalizeType(type) {
  if (!type) return 'unknown';
  const value = String(type).toLowerCase();
  return value === 'boolean' ? 'bool' : value;
}

function normalizeMap(map) {
  const result = {};
  for (const [path, info] of Object.entries(map || {})) {
    result[path] = {
      type: normalizeType(info && info.type),
      description: info && info.description,
    };
  }
  return result;
}

async function loadSchema(document) {
  const uri = schemaUriFor(document);
  if (!uri) return null;
  const key = uri.toString();
  if (cache.has(key)) return cache.get(key);
  try {
    const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
    const text = open
      ? open.getText()
      : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      cache.set(key, null);
      return null;
    }
    const schema = { in: normalizeMap(parsed.in), out: normalizeMap(parsed.out) };
    cache.set(key, schema);
    return schema;
  } catch (error) {
    cache.set(key, null);
    return null;
  }
}

function clearSchema(uri) {
  cache.delete(uri.toString());
}

function clearAllSchemas() {
  cache.clear();
}

module.exports = { schemaUriFor, loadSchema, clearSchema, clearAllSchemas };
