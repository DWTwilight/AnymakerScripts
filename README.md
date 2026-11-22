# AnyMakerScripts

Workspace for AnyMaker `.amc` scripts, editor tooling, and an agent skill.

## Contents

- `src/` – Golf GTI MK8 car script, databus schema, and design notes.
  - `Golf_GTI_MK8.amc` – engine, transmission, brakes, steering, lights, dials, radio, doors
  - `Golf_GTI_MK8.json` – databus `in`/`out` definitions
  - `Golf_GTI_MK8.md` – implementation notes
- `vscode-extension/` – VS Code extension with syntax highlighting, diagnostics, IntelliSense, formatting, and databus schema support. See its [README](vscode-extension/README.md) for install and features.
- `.opencode/skills/anymaker-scripting/` – language reference and runnable examples for the AnyMaker scripting language.

## Usage

A script automatically uses the JSON file with the same basename: `Foo.amc` reads and writes the databus defined in `Foo.json`. Guard databus access with `requires (in|out Path.name) { ... }`.

To install the editor extension, follow [vscode-extension/README.md](vscode-extension/README.md).

## License

GPL-3.0. See [LICENSE](LICENSE).
