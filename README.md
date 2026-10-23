# opencode-terminal-title

An OpenCode V2 TUI plugin that removes a configurable terminal-title prefix (default `OC | `), animates a configurable spinner while a session is working, and prepends a configurable marker when a session is waiting for you.

| State | Terminal title |
| --- | --- |
| Normal session | `Fix auth` instead of `OC \| Fix auth` |
| The session is working: agent, subagent, or shell | `⠋ Fix auth` (animated) |
| The last assistant message ends with `needs input:` | `◉ Fix auth` |
| A permission request or form is pending, including subagents | `◉ Fix auth` |
| The session is idle | `Fix auth` |
| Home or plugin page | `OpenCode` |

## Install

```sh
opencode plugin add github:kerbyfc/opencode-terminal-title
```

Or copy this directory to `~/.config/opencode/plugins/terminal-title` (`tui.ts` and `package.json` are enough). Restart OpenCode after installing.

## Settings

Options are passed through `cli.json` using the object form of a plugin entry:

```json
{
  "plugins": [
    {
      "package": "github:kerbyfc/opencode-terminal-title",
      "options": {
        "strip": "^OC \\| ",
        "marker": "◉",
        "spinner": ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
        "spinnerInterval": 100
      }
    }
  ]
}
```

- `strip` — a JavaScript regular expression source applied to every terminal title. The first match is removed. Default: `^OC \| `, which removes the `OC | ` prefix.
- `marker` — the symbol prepended when the session is waiting. The plugin adds one space after it; set it to `""` to disable the marker. Default: `◉`.
- `spinner` — frames of the working animation. Set it to `false` or `[]` to disable the spinner. Default: `["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]`.
- `spinnerInterval` — milliseconds between spinner frames. Default: `100`.

The `strip` value is JSON, so a literal backslash is doubled: `"^OC \\| "` becomes the regex `^OC \| `. `|` is a regex metacharacter (alternation), so it must be escaped. A character class avoids the escaping: `"^OC [|] "` is the same prefix.

## Test

```sh
npm test
```

## How it works

The TUI sets the terminal title through `renderer.setTerminalTitle`. The plugin wraps that method, applies the configured `strip` regex, and adds the configured spinner or marker. A session counts as working while the agent, any subagent in its family, a pending inbox item, or a shell is running. `needs input:` is read from the last non-empty line of the latest assistant message; change `NEEDS_INPUT` in `tui.ts` if your convention differs.

This is a TUI-only plugin: it belongs in `cli.json` or the auto-discovered `~/.config/opencode/plugins` directory, not in `opencode.json`.

## Limitations

- The plugin relies on the public `renderer.setTerminalTitle` method from OpenTUI rather than a dedicated title hook. If that API changes, the plugin may stop working; this only affects the local TUI, not the server.
- The marker also appears while a permission request or form is pending: both mean the session is waiting for you.
