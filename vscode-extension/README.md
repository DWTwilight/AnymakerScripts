# AnyMaker Scripting (VS Code extension)

Syntax highlighting, scope-aware coloring, and diagnostics for AnyMaker `.amc`
scripts.

## Install (Remote-WSL, Windows VS Code)

The extension runs as a **workspace** extension, so install it on the side that
actually hosts the folder:

- Local Windows folder (`F:\...`): install into Windows VS Code.
- Remote-WSL window: install into the WSL extension host.

1. Package it:

   ```sh
   npx @vscode/vsce package --no-dependencies --allow-missing-repository
   ```

2. Install into Windows VS Code (local folder):

   ```sh
   cmd.exe /c code --install-extension "$(wslpath -w "$PWD/anymaker-scripting-0.4.0.vsix")" --force
   ```

   Or, inside a Remote-WSL window, use the integrated terminal:

   ```sh
   code --install-extension "$PWD/anymaker-scripting-0.4.0.vsix" --force
   ```

3. Reload VS Code.

## Scope-aware colors

On top of the TextMate grammar, a small analyzer classifies identifiers by scope
and recolors them with editor decorations:

- **Global variables** (`define var` / `define list` at top level, and their
  `var` references): amber on dark themes, dark-amber on light themes.
- **Function parameters** (signature declarations and `param` references):
  purple.
- **`in` databus variables** (script writes to the game): teal.
- **`out` databus variables** (script reads from the game): green.
- **Local variables** keep the theme's normal variable color.

Colors adapt to the active dark/light/high-contrast theme.

## What is highlighted

- `#` comments
- Double-quoted strings
- `define var|list|type|member|function` declarations and declared names
- Built-in types (`bool`, `integer`, `fractional`, `string`, `analogue`)
- `in` / `out` databus paths
- `param`, `call`, `var` references
- Control flow (`if`, `elseif`, `else`, `repeat`, `contains`, `on_tick`)
- Built-in math / conversion functions
- Numbers, operators, punctuation

## Diagnostics

Problems are reported in the editor and the Problems panel. The checker parses
the script and validates the language rules, including:

- declaration forms (`define var` with no initializer, `define list` element
  types, top-level-only `type`/`function`, `member` only inside a type)
- reserved keyword names, duplicate names, and no shadowing
- `elseif` spelling, semicolons, `!=`, `+=`, `++`, `.5`, `1e3`, unsupported
  loops (`while`/`for`) and `break`/`continue`/`return`
- undeclared variables/params and use of parameters via the wrong keyword
- list rules (read-only elements, no list literals, no `==` on lists, no list
  members, `contains` only on lists)
- type checking for arithmetic, comparisons, logic, assignments, built-in
  functions, and user function arguments
- structural rules (`on_tick` once, functions before `on_tick`, no top-level
  `call`/`repeat`, no recursion, no forward calls)
- comments longer than 31 characters (warning)

Databus `in`/`out` names and types come from the game, so they are not checked.
