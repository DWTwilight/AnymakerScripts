# AnyMaker Scripting (VS Code extension)

Syntax highlighting for AnyMaker `.amc` scripts.

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
   cmd.exe /c code --install-extension "$(wslpath -w "$PWD/anymaker-scripting-0.3.0.vsix")" --force
   ```

   Or, inside a Remote-WSL window, use the integrated terminal:

   ```sh
   code --install-extension "$PWD/anymaker-scripting-0.3.0.vsix" --force
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

A syntax **checker** (diagnostics) is not included yet.
