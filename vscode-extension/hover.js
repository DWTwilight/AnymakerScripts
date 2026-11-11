'use strict';

const NUM = 'integer | fractional';

const BUILTINS = new Map([
  ['abs', { signature: `abs (x: ${NUM}) -> ${NUM}`, description: 'Absolute value. Takes integer or fractional and returns the same numeric type.' }],
  ['floor', { signature: `floor (x: ${NUM}) -> ${NUM}`, description: 'Round down. Takes integer or fractional and returns the same numeric type.' }],
  ['ceil', { signature: `ceil (x: ${NUM}) -> ${NUM}`, description: 'Round up. Takes integer or fractional and returns the same numeric type.' }],
  ['round', { signature: `round (x: ${NUM}) -> ${NUM}`, description: 'Round to nearest. Takes integer or fractional and returns the same numeric type.' }],
  ['sqrt', { signature: `sqrt (x: ${NUM}) -> ${NUM}`, description: 'Square root. Takes integer or fractional and returns the same numeric type.' }],
  ['exp', { signature: `exp (x: ${NUM}) -> fractional`, description: 'e raised to x. Takes a numeric value and returns fractional.' }],
  ['ln', { signature: `ln (x: ${NUM}) -> fractional`, description: 'Natural logarithm. Takes a numeric value and returns fractional.' }],
  ['log2', { signature: `log2 (x: ${NUM}) -> fractional`, description: 'Base-2 logarithm. Takes a numeric value and returns fractional.' }],
  ['sin', { signature: 'sin (x: fractional) -> fractional', description: 'Sine. Requires a fractional argument and returns fractional.' }],
  ['cos', { signature: 'cos (x: fractional) -> fractional', description: 'Cosine. Requires a fractional argument and returns fractional.' }],
  ['tan', { signature: 'tan (x: fractional) -> fractional', description: 'Tangent. Requires a fractional argument and returns fractional.' }],
  ['asin', { signature: 'asin (x: fractional) -> fractional', description: 'Arcsine. Requires a fractional argument and returns fractional.' }],
  ['acos', { signature: 'acos (x: fractional) -> fractional', description: 'Arccosine. Requires a fractional argument and returns fractional.' }],
  ['atan', { signature: 'atan (x: fractional) -> fractional', description: 'Arctangent. Requires a fractional argument and returns fractional.' }],
  ['rand', { signature: `rand (a: ${NUM}, b: ${NUM}) -> ${NUM}`, description: 'Random value of the same numeric type, inclusive of both ends. Both arguments must have the same type.' }],
  ['len', { signature: 'len (x: string | list) -> integer', description: 'Length of a string or list. Returns integer.' }],
  ['to_integer', { signature: `to_integer (x: ${NUM}) -> integer`, description: 'Convert a numeric value to integer, rounding to nearest (ties to even).' }],
  ['to_fractional', { signature: 'to_fractional (x: integer) -> fractional', description: 'Convert an integer to fractional.' }],
]);

const KEYWORDS = new Map([
  ['define', { signature: 'define ...', description: 'Start a declaration: `define var`, `define list`, `define type`, `define member`, or `define function`.' }],
  ['var', { signature: 'var name', description: '`define var` declares a variable. `var name = value` assigns it. Read a variable as `var name`.' }],
  ['param', { signature: 'param name', description: 'Refer to a function parameter. Read as `param name`; write an output with `param name = value`.' }],
  ['list', { signature: 'define list <elementType> <name>', description: 'Declare a list. Element types: bool, integer, fractional, or a custom type. `string` crashes at runtime. Elements are read-only.' }],
  ['type', { signature: 'define type Name { ... }', description: 'Declare a custom value type at top level. Members use `define member <type> <name>` and must not be lists. Recursive types are not supported.' }],
  ['member', { signature: 'define member <type> <name>', description: 'Declare a field inside a `define type` block.' }],
  ['function', { signature: 'define function name (type param, ...) { ... }', description: 'Define a function at top level before `on_tick`. No return value, recursion, or overloading. Use writable parameters for outputs.' }],
  ['call', { signature: 'call name (arg, ...)', description: 'Call a user-defined function. The function must be defined before the call. Lists cannot be arguments.' }],
  ['on_tick', { signature: 'on_tick { ... }', description: 'The only entrypoint; it runs every game tick (~60/sec). There may be only one. No tick delta or world API is provided.' }],
  ['in', { signature: 'in Path.name = value', description: 'Write a databus input to affect the game. `in` values are write-only.' }],
  ['out', { signature: 'out Path.name', description: 'Read a databus output. Can be used directly inside expressions.' }],
  ['if', { signature: 'if (condition) { ... }', description: 'Branch on a bool condition.' }],
  ['elseif', { signature: 'elseif (condition) { ... }', description: 'Additional branch. `elseif` is one word; `else if` is invalid.' }],
  ['else', { signature: 'else { ... }', description: 'Fallback branch with no condition.' }],
  ['repeat', { signature: 'repeat (count) { ... }', description: 'Run the body a fixed number of times. Count must be integer and is re-evaluated every iteration. No break/continue.' }],
  ['contains', { signature: 'list contains value', description: 'List membership test. Only valid on lists; custom values use field-wise equality.' }],
  ['requires', { signature: 'requires (in|out Path.name) { ... }', description: 'Availability guard: runs the block only when the named databus `in`/`out` variable is present (not null). The condition is a single databus variable, not a bool expression.' }],
  ['true', { signature: 'true', description: 'Boolean literal.' }],
  ['false', { signature: 'false', description: 'Boolean literal.' }],
]);

const TYPES = new Map([
  ['bool', { signature: 'bool', description: 'Boolean: `true` or `false`.' }],
  ['integer', { signature: 'integer', description: '32-bit signed integer. Division/modulo truncate toward zero; division by zero returns 0.' }],
  ['fractional', { signature: 'fractional', description: '32-bit float. Needs a digit before the dot (`0.5`); exponent notation is not supported.' }],
  ['string', { signature: 'string', description: 'Double-quoted with no escape sequences. Supports `len` and `==`; there is no concatenation.' }],
  ['analogue', { signature: 'analogue', description: 'Stream-like scalar. Semantics and null handling are outside the current scope.' }],
]);

const BUILTIN_PARAMS = new Map([
  ['abs', ['x']],
  ['floor', ['x']],
  ['ceil', ['x']],
  ['round', ['x']],
  ['sqrt', ['x']],
  ['exp', ['x']],
  ['ln', ['x']],
  ['log2', ['x']],
  ['sin', ['x']],
  ['cos', ['x']],
  ['tan', ['x']],
  ['asin', ['x']],
  ['acos', ['x']],
  ['atan', ['x']],
  ['rand', ['a', 'b']],
  ['len', ['x']],
  ['to_integer', ['x']],
  ['to_fractional', ['x']],
]);

function lookupHover(word) {
  return BUILTINS.get(word) || KEYWORDS.get(word) || TYPES.get(word) || null;
}

function builtinSignature(word) {
  const info = BUILTINS.get(word);
  if (!info) return null;
  const params = BUILTIN_PARAMS.get(word) || [];
  return {
    label: info.signature,
    documentation: info.description,
    parameters: params.map((name) => ({ label: name, documentation: '' })),
  };
}

module.exports = { lookupHover, builtinSignature, BUILTINS };
