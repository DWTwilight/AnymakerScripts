'use strict';

const vscode = require('vscode');

const cache = new Map();
const errors = new Map();

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
  if (!map || typeof map !== 'object' || Array.isArray(map)) return result;
  for (const [path, info] of Object.entries(map)) {
    result[path] = {
      type: normalizeType(info && info.type),
      description: info && info.description,
    };
  }
  return result;
}

function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      output += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }
    if (ch === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      if (i < input.length) output += '\n';
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++;
      output += ' ';
      continue;
    }
    output += ch;
  }

  return output;
}

function stripTrailingCommas(input) {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      output += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '}' || input[j] === ']') continue;
    }
    output += ch;
  }

  return output;
}

function parseSchemaText(text) {
  const source = text.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(source);
  } catch (firstError) {
    try {
      return JSON.parse(stripTrailingCommas(stripJsonComments(source)));
    } catch (secondError) {
      throw secondError;
    }
  }
}

async function loadSchema(document) {
  const uri = schemaUriFor(document);
  if (!uri) return null;

  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
  const cacheKey = open ? `${key}@${open.version}` : key;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (cached) errors.delete(key);
    return cached;
  }

  const fileName = uri.path.split('/').pop();

  try {
    const text = open
      ? open.getText()
      : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

    let parsed;
    try {
      parsed = parseSchemaText(text);
    } catch (error) {
      errors.set(key, `Databus schema '${fileName}' is not valid JSON: ${error.message}`);
      cache.set(cacheKey, null);
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.set(key, `Databus schema '${fileName}' must be a JSON object.`);
      cache.set(cacheKey, null);
      return null;
    }

    const validSection = (section) =>
      section === undefined || (section && typeof section === 'object' && !Array.isArray(section));
    if (!validSection(parsed.in) || !validSection(parsed.out)) {
      errors.set(key, `Databus schema '${fileName}' must use objects for "in" and "out".`);
      cache.set(cacheKey, null);
      return null;
    }

    const schema = { in: normalizeMap(parsed.in), out: normalizeMap(parsed.out) };
    errors.delete(key);
    cache.set(cacheKey, schema);
    return schema;
  } catch (error) {
    // Missing/unreadable file: treat as "no schema" rather than an error.
    errors.delete(key);
    cache.set(cacheKey, null);
    return null;
  }
}

function getSchemaError(document) {
  const uri = schemaUriFor(document);
  if (!uri) return null;
  return errors.get(uri.toString()) || null;
}

function clearSchema(uri) {
  const key = uri.toString();
  cache.delete(key);
  errors.delete(key);
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${uri.toString()}@`)) cache.delete(key);
  }
}

function clearAllSchemas() {
  cache.clear();
  errors.clear();
}

module.exports = {
  schemaUriFor,
  loadSchema,
  getSchemaError,
  clearSchema,
  clearAllSchemas,
};
