# opencode-terminal-title

An OpenCode V2 TUI plugin that removes the `OC | ` prefix from the terminal title and prepends `◉ ` when a session is waiting for you.

| State | Terminal title |
| --- | --- |
| Normal session | `Fix auth` instead of `OC \| Fix auth` |
| The last assistant message ends with `needs input:` | `◉ Fix auth` |
| A permission request or form is pending, including subagents | `◉ Fix auth` |
| The session is running again, or the reply has no status | `Fix auth` |
| Home or plugin page | `OpenCode` |

## Install

```sh
opencode plugin add github:kerbyfc/opencode-terminal-title
```

Or copy this directory to `~/.config/opencode/plugins/terminal-title` (`tui.ts` and `package.json` are enough). Restart OpenCode after installing.

## Test

```sh
npm test
```

## How it works

The TUI sets the terminal title through `renderer.setTerminalTitle`. The plugin wraps that method, strips `OC | `, and adds the marker. `needs input:` is read from the last non-empty line of the latest assistant message; change `NEEDS_INPUT` in `tui.ts` if your convention differs.

This is a TUI-only plugin: it belongs in `cli.json` or the auto-discovered `~/.config/opencode/plugins` directory, not in `opencode.json`.

## Limitations

- The plugin relies on the public `renderer.setTerminalTitle` method from OpenTUI rather than a dedicated title hook. If that API changes, the plugin may stop working; this only affects the local TUI, not the server.
- The `◉` marker also appears while a permission request or form is pending: both mean the session is waiting for you.
