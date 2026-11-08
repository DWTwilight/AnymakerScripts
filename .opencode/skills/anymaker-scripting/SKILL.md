---
name: anymaker-scripting
description: Use when writing or editing AnyMaker game scripts (.amc files) in the AnyMaker custom scripting language. Covers syntax, types, variables, databus I/O, functions, operators, branching, loops, and the on_tick entrypoint.
---

# AnyMaker scripting (.amc)

AnyMaker scripts live in `.amc` files and are made of `define` declarations plus
event blocks such as `on_tick`. Runnable scripts are in [`examples/`](examples/);
see [Practical examples](#practical-examples).

## Practical rules

- **Never trust defaults.** Assign every variable and member before reading it.
- **Never intentionally do dangerous operations** (divide by zero, index out of
  range). Guard the input first.
- **Do not code around unlikely cases.** Handle them when they actually arise.

## Comments

A comment is a `#` line, limited to **31 characters**:

```
#stream like type
```

## Data types

| Type         | Kind                | Declaration                                |
| ------------ | ------------------- | ------------------------------------------ |
| `bool`       | built-in scalar     | `define var bool <name>`                   |
| `integer`    | built-in scalar     | `define var integer <name>`                |
| `fractional` | built-in scalar     | `define var fractional <name>`             |
| `string`     | built-in scalar     | `define var string <name>`                 |
| `analogue`   | stream-like scalar  | `define var analogue <name>`               |
| `list`       | generic container   | `define list <elementType> <name>`         |
| custom type  | user-defined record | `define var <TypeName> <name>`             |

### Numeric limits

- `integer` is 32-bit signed: max `2147483647`, min `-2147483648`.
- `fractional` is a 32-bit (single-precision) float.
- Integer overflow wraps around: `2147483647 + 1` becomes `-2147483648`.
- Negative division/modulo truncate toward zero: `-7 / 2` is `-3`, `-7 % 2` is `-1`.
- Division by zero returns `0` with no error; never rely on it.

### Literals

```
var boolVal = true
var intVal = 888
var negInt = -1
var strVal = "a string with space"
var fracVal = 5.5
var negFrac = -1.0
```

- `bool`: `true`, `false`.
- `integer`: bare digits, e.g. `888`; negative is `-1`.
- `fractional`: digits with a decimal point, e.g. `5.5`; negative is `-1.0`.
  A digit is required before the dot (`.5` is invalid; write `0.5`). A trailing
  dot (`1.`) is accepted, but prefer `1.0`.
- Exponent notation (`1e3`) is **not supported**; write `1000.0`.
- `string`: double-quoted, may contain spaces. **No escape syntax** — `\n`,
  `\"`, and `\\` are literal characters, and a quote cannot be escaped inside a
  string.

### Default values

An uninitialized declaration holds the type default: `false`, `0`, `0`, `""`,
`null` for `analogue`, and an empty list for `list`.

- `[]` is not writable syntax; it only describes a newly created empty list.
- A custom type's members default to the defaults above.
- Do not rely on any of this; assign explicitly.

## Variables

All ordinary variables use `define var <type> <name>`:

```
define var bool boolVal
define var integer intVal
define var fractional fracVal
define var string strVal
define var analogue anaVal
```

- `define var` takes **no initializer**; `define var integer i = 0` is invalid.
- Declarations may follow other statements in the same block, but a name may be
  declared only once per block; duplicates are rejected.

### Naming rules

1. **Never use a reserved keyword as a name.** `out` and `in` are keywords, so
   they cannot be variables, parameters, functions, or type names. Known
   keywords: `bool`, `integer`, `fractional`, `string`, `analogue`, `list`,
   `type`, `member`, `define`, `var`, `param`, `function`, `call`, `on_tick`,
   `in`, `out`, `if`, `elseif`, `else`, `repeat`, `true`, `false`, `contains`.
2. **Never reuse a name.** Give every variable, parameter, function, type, and
   member a unique name — no shadowing, no duplicate members across types.
3. **Naming convention.** Use `camelCase` for ordinary variables, parameters,
   functions, and members. Use `SCREAMING_SNAKE_CASE` for constants — global
   tuning values that are initialized once and never reassigned (e.g.
   `WHEEL_BASE`, `IDLE_RPS`, `STEER_DEAD_ZONE`). Constants are still ordinary
   variables to the language; the convention is stylistic.

Treat these rules as absolute even if the parser sometimes accepts a violation.

### Assignment

Assign with `var <name> = <value>`. `define var` declares; `var` assigns:

```
define var integer intVal
var intVal = 1
```

Use **one statement per line** — semicolons and multiple statements on a line
are not supported.

## Type conversion

Use `to_<type> (...)`; note the space before the parenthesis:

```
var intVal = to_integer (var fracVal)
var fracVal = to_fractional (var intVal)
```

- `to_integer` **rounds to nearest** (does not truncate): `1.9` -> `2`, `-1.9` ->
  `-2`, `±0.5` -> `0`. Ties round to even: `1.5`/`2.5` -> `2`, `3.5` -> `4`.
- `to_fractional` converts an integer to `fractional`.
- Arguments are variable references prefixed with `var`.
- Only these two exist; `to_bool` / `to_string` are not supported.

## Strings and length

`len (...)` returns the number of characters in a string or elements in a list:

```
var n = len (var str)
var n = len (var myList)
```

Beyond `len` and `==`, there is no string manipulation and no concatenation
operator.

## Lists

Declare with `define list` (**no `var`**) plus element type and name:

```
define list integer myList
```

Supported element types: `integer`, `fractional`, `bool`, and custom types.
**`define list string` crashes at runtime.**

Mutate with `var <listName> <method>`:

```
var myList append (1)
var myList append (2)
var myList append (3)
var myList insert (4, 0)
var myList erase (1)
var myList clear
```

- `append (value)` — add to the end.
- `insert (value, index)` — insert `value` at `index` (value first).
- `erase (index)` — remove element at `index`.
- `clear` — remove all elements; **no parentheses**. Works on global lists too.

Starting empty, the calls above give `[1]`, `[1, 2]`, `[1, 2, 3]`,
`[4, 1, 2, 3]`, `[4, 2, 3]`, then `[]` (brackets illustrative only).

Indexing is **zero-based and read-only**; there is no element assignment
(`var myList[i] = ...` is rejected). Read an element into a variable:

```
var i = var myList[2]
```

Out-of-range access raises an **error**; check `len (...)` first.

- Whole lists cannot be copied, assigned, or compared with `==`. Build a new
  list by appending elements read from the original.
- Lists store **value copies**, including custom types. Changing a copied
  element does not affect the list.
- A top-level `define list` is global and persists across ticks.

## Custom types

Define a record with `define type` and its fields with `define member`:

```
define type CustomType
{
	define member bool boolMember
	define member integer intMember
}
```

Declare an instance with `define var`, then use dot access:

```
define var MyType obj
var obj.intMember = 1
var obj.boolMember = false
define var integer i
var i = var obj.intMember
```

- Write: `var <obj>.<member> = <value>`. Read: `var <target> = var <obj>.<member>`.
- Members are not initialized inline; uninitialized members hold their type
  defaults, but assign them explicitly.
- Custom values are **value types**: copies and parameter passing copy by value.
- **Composite members are allowed** (a member can be another custom type).
- **List members are not supported** inside `define type`, including lists of
  custom types.
- **Recursive types are not supported**, directly or indirectly.
- **`define type` is top-level only**; it cannot appear in `on_tick`, a
  function, or another block.
- **Nested access is rejected**: `var o.inner.v` fails. Copy the nested object to
  an intermediate variable first, then access its member:
  `var innerCopy = var outer.inner` / `var innerCopy.v = 7`.
- `==` is **field-wise equality**: distinct objects with equal members compare
  equal.
- In functions, read members with `param p.a`; `param p.a = ...` does not
  compile. Copy to a local first: `var tmp = param p`, then use `var tmp.a`.

## Variable scope

A top-level `define var` is **global**, shared across ticks and visible to event
blocks. A `define var` inside a block is **local** to that block:

```
define var bool globalVar
on_tick
{
	define var integer intVal
}
```

Use globals for state that persists between ticks; use locals for per-tick
temporaries. **Locals reset to defaults at the start of every tick.**

Prefer **inlining** a single-use temporary directly into the expression that
consumes it; declare a local only when the value is reused, needs a name for
clarity, or must persist across statements. For example, inline
`abs (var steerInput) * var MAX_VIRTUAL_STEER_ANG` directly into a `tan (...)`
call instead of assigning it to an intermediate local first. Chained math calls
are fine inline: `atan (var WHEEL_BASE / (var radius + var TRACK_WIDTH * 0.5))`.

Declarations inside `if` / `elseif` / `else` / `repeat` are scoped to that
block. Declare in the enclosing scope if the variable must outlive the block.

**Do not shadow.** Reusing an outer name in a nested block is unsafe: the inner
declaration can take over the name, and the effect persists after the block.

## Event blocks / entrypoint

`on_tick` is the script entrypoint, called **every game tick (~60/sec)**:

```
on_tick
{
	define var integer intVal
}
```

- Top-level declarations and code sit outside `on_tick`.
- Do not call `on_tick` yourself; the engine invokes it.
- Keep it lightweight; avoid per-tick work that is only occasionally needed.
- Multiple scripts run in parallel; do not assume ordering between them.
- It is the **only entrypoint** and there may be only **one** block. There are
  no start, input, timer, draw, or collision callbacks.
- There is **no tick delta/time value** and no callable game/world/entity API.
  The game is affected only by writing databus `in` variables.

Since no time value is provided, measure time with a global tick counter:

```
define var integer ticks
on_tick
{
	var ticks = var ticks + 1
	#every 60 ticks is about one second
}
```

### Global (top-level) code

Statements at the top level run **once at load, before the first tick**. Use
them to initialize globals:

```
define var integer count
var count = 0
on_tick
{
	var count = var count + 1
}
```

- Global code can contain ordinary statements and math/type-conversion
  intrinsics such as `atan (...)`, `tan (...)`, and `to_integer (...)`;
  **user-defined `call` functions and `repeat` loops are not allowed** there.
- Use top-level code to compute derived constants **once at load** instead of
  repeating the work every tick:

```
define var fractional WHEEL_BASE
define var fractional TRACK_WIDTH
define var fractional MAX_VIRTUAL_STEER_ANG
define var fractional MAX_INNER_STEER_ANGLE
var WHEEL_BASE = 2.72
var TRACK_WIDTH = 1.52
var MAX_VIRTUAL_STEER_ANG = 0.5236
var MAX_INNER_STEER_ANGLE = atan (var WHEEL_BASE / (var WHEEL_BASE / tan (var MAX_VIRTUAL_STEER_ANG) - var TRACK_WIDTH * 0.5))
```

- For one-time setup needing a user-defined call or loop, use an init flag in
  `on_tick`:

```
define var bool initialized
var initialized = false
on_tick
{
	if (! (var initialized))
	{
		#one-time setup here
		var initialized = true
	}
}
```

## Databus I/O variables

A script is connected to a **databus** exposing external variables defined
outside the script. They are never declared and are used directly with the `in`
/ `out` prefixes (no `define var`, no `var`).

- `in <path>` — external **input**; the script **writes** it to affect the game.
- `out <path>` — external **output**; the script **reads** its value. Use it
  directly inside expressions, comparisons, `if` conditions, and function
  arguments — copying into a temporary local first is unnecessary:
  `var open = out FL_Door_Handle.is_active && ! (out Door_Lock.is_pressed)`.
- Paths are dotted names such as `Dial.is_illuminated` or
  `FL_Door_Handle_Outer.is_active`. Their availability and types depend on the
  databus; names and types are supplied by the user, so never invent them. They
  may optionally be recorded in a same-basename `.json` editor helper (below).

```
in <inputPath> = <value>
var <local> = out <outputPath>
```

`in A = out B` is a plain **value copy** at execution time, not a persistent
binding:

```
on_tick
{
	in Dial.is_illuminated = out FL_Door_Handle_Outer.is_active
}
```

Put such statements in `on_tick` to copy each tick, or in global code for a
one-time copy.

### Optional databus schema (editor helper only)

The game does **not** read this file. A script may have a JSON file with the
**same basename** in the same folder, used only by editors/tooling:

```
Foo.amc  <->  Foo.json
```

```json
{
  "in": {
    "Lamp.is_on": {
      "type": "bool",
      "description": "true turns the lamp on"
    }
  },
  "out": {}
}
```

- `in` — paths the script **writes** (affect the game).
- `out` — paths the script **reads** (come from the game).
- `type` is `bool`, `integer`, `fractional`, `string`, or `analogue`
  (`boolean` is accepted as `bool`). `description` is free text.
- The AnyMaker Scripting VS Code extension uses it for path validation,
  completion after `in` / `out`, and hover type/description.
- **Not required by the game**: scripts run normally without it.

## Functions

Define with `define function <name> (<type> <param>, ...)`:

```
define function func (integer value, integer result)
{
	param result = param value + 1
}
```

Call with `call`:

```
on_tick
{
	define var integer i
	#i should be 2
	call func (1, var i)
}
```

- Parameters are comma-separated and typed. Refer to them inside the body with
  `param <name>`, not `var`.
- Functions must be declared at **top level, before `on_tick`**, not inside a
  block or another function.
- **Recursion and overloading are not supported.** Names must be unique.
- A function may call another only if that function is **defined before** the
  call (no forward references).
- Function locals reset on every call.
- Functions can read/write globals directly, read databus `out`, and write
  databus `in` directly.
- **Lists cannot be parameters.** Scalar types, `string`, and custom types can.
- Multiple output parameters are allowed (several `var`-passed params).
- `in` values are write-only and cannot be arguments.
- Arguments may be literals, variables, expressions, custom members, list
  elements, or databus `out` values. Inside a function, pass a parameter with
  `param <name>`.
- A parameter passed as `var <name>` is writable and updates the caller.
- There is no `return`; results come through writable parameters.

Custom values are **copied by value**. After `var tmp = param p`, changing
`var tmp.a` does not change the caller. Assign the whole local back to the
output param instead:

```
define function pair_make (integer a, integer b, Pair outP)
{
	define var Pair tmp
	var tmp.a = param a
	var tmp.b = param b
	param outP = var tmp
}
```

## Operators

### Grouping / precedence

`^`, `*`, `/`, and `%` bind tighter than `+` and `-`. All binary arithmetic
operators, including `^`, are **left-associative**: `2 ^ 3 ^ 2` is
`(2 ^ 3) ^ 2 = 64`. Use parentheses to make intent explicit:

```
var i = (var i + var i) * var i
```

### Arithmetic

```
var a = var a + var b
var b = var a % var b
var fa = var fa + var fb
var a = var a ^ var a
```

- Operators: `+`, `-`, `*`, `/`, `%` (remainder), `^` (exponentiation).
- **Operand types must match.** Do not mix `integer` and `fractional`; convert
  first. This applies broadly, not just to arithmetic.
- `/` and `%` with negatives truncate toward zero. Division by zero returns `0`
  with no error.

### Comparison

```
var boolVal = var a > var b
var boolVal = var a == var b
```

- Operators: `>`, `<`, `<=`, `>=`, `==`.
- Operand types must match.
- **Chained comparisons are not supported**; combine with `&&`:
  `var inRange = (var a < var b) && (var b < var c)`.
- `==` works on `string`, `bool`, `fractional`, and custom values (field-wise).
  It is **not supported for lists**.
- Assignment uses `var <name> = ...`; `==` is equality inside an expression.

### Logical

```
var boolVal = var boolVal && var boolVal
var boolVal = var boolVal || var boolVal
var boolVal = ! (var boolVal)
```

- `&&` = AND, `||` = OR, `!` = NOT. `&&` and `||` short-circuit.
- `!` **must** have a space and a parenthesized operand: `! (var flag)`.

### List membership

```
var boolVal = var myList contains var a
```

`contains` is **list-only** and uses field-wise equality for custom values.

There are **no other operators**: no `!=`, no unary `+`, no compound assignment
(`+=`), no `++`, and no string concatenation. Unary `-` is allowed only on
numeric literals (`-1`, `-1.0`), not variables or expressions.

## Math functions

Called with a space before `(`.

| Function                                                          | Input                 | Output                |
| ----------------------------------------------------------------- | --------------------- | --------------------- |
| `abs (x)`, `floor (x)`, `ceil (x)`, `round (x)`, `sqrt (x)`       | integer or fractional | integer or fractional |
| `exp (x)`, `ln (x)`, `log2 (x)`                                   | integer or fractional | fractional            |
| `sin (x)`, `cos (x)`, `tan (x)`, `asin (x)`, `acos (x)`, `atan (x)` | fractional only     | fractional            |
| `rand (a, b)`                                                     | integer or fractional | same numeric type     |

`rand (a, b)` takes two arguments of the same numeric type and returns that
type, inclusive of both ends: `rand (1, 2)` returns `1` or `2`.

## Branching

Use `if` / `elseif` / `else`. Conditions go in parentheses and reference
variables with `var`:

```
if (var cond)
{
	#dosomething1
}
elseif (var intVal > 0)
{
	#dosth2
}
else
{
	#dosth3
}
```

- `elseif` is one word (not `else if`).
- `else` takes no condition.
- Each branch body is wrapped in `{ }`.

## Loops

`repeat (<count>)` runs the body a fixed number of times:

```
repeat (5)
{
	#do sth for 5 times
}
```

The count may also be an integer variable or an arithmetic expression:

```
repeat (var n)
{
	#runs n times
}
repeat (var a + var b)
{
	#ok
}
```

- Count must be an `integer`; use `to_integer` for a `fractional`.
- A count of `0` runs the body zero times.
- The count is **re-evaluated every iteration**; changing its variable inside
  the body changes the number of remaining iterations.
- A `define var` inside `repeat` resets every iteration.
- Avoid negative counts.
- `repeat` must be inside `on_tick` or a function, not top-level global code.
- No loop index is exposed; declare a counter outside and update it manually.
- **No other loop forms:** no `while` or `for`, and no `break`, `continue`, or
  `return`.

## Practical examples

Complete `.amc` scripts live in [`examples/`](examples/). Each file begins with
the databus paths it expects; bind those `in`/`out` variables with the types
noted in the comments before testing. Tune the named globals (periods, limits,
rates) to match your game.

Every example has a companion same-basename databus schema (e.g.,
[`blink_lamp.json`](examples/blink_lamp.json) for
[`blink_lamp.amc`](examples/blink_lamp.amc)). The JSON is only an editor helper
and is not required by the game.

| Example | What it shows |
| ------- | ------------- |
| [blink_lamp.amc](examples/blink_lamp.amc) | Tick counter, global state, toggling a `bool` input. |
| [edge_counter.amc](examples/edge_counter.amc) | Edge detection, incrementing a counter output. |
| [fade_lamp.amc](examples/fade_lamp.amc) | Fractional ramping, clamping, function with an output param. |
| [thermostat.amc](examples/thermostat.amc) | Hysteresis control loop with two thresholds. |
| [traffic_light.amc](examples/traffic_light.amc) | Multi-phase state machine, custom-type config, combined `bool` expressions. |
| [smooth_sensor.amc](examples/smooth_sensor.amc) | Global list, sliding window, `len`, literal indexing, averaging function. |
| [stairwell_light.amc](examples/stairwell_light.amc) | Custom-type state, button edge, tick countdown. |
| [strobe_pattern.amc](examples/strobe_pattern.amc) | Global init flag, `repeat` in `on_tick`, list rotation, modulo pattern. |
| [breathing_lamp.amc](examples/breathing_lamp.amc) | `sin` and fractional math for smooth animation. |

Start with `blink_lamp`, `edge_counter`, and `fade_lamp`; then the control loops
and state machines; save the list/custom-type examples for persistent structured
state.

## Out of scope

- `analogue` semantics and `null` handling.
- String manipulation beyond `len` and `==` (there is no concatenation).
- Databus `in` / `out` names and types, which the user supplies. The optional
  same-basename `.json` is only an editor helper and is not required by the
  game.
- Language features are subjects to change, expect errors and corrections by user.
