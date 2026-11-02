# pi-simple-status-footer

English | [简体中文](README.zh-CN.md)

A small custom footer for the Pi coding agent. It replaces the built-in footer
with a responsive status line and adds Git change counts plus session duration.

## Displayed values

- Model ID with a robot icon and provider in parentheses
- Thinking level behind a brain icon
- Working directory and session name with a folder icon
- Git branch with branch icon, staged, unstaged, and untracked counts
- Input and output tokens with up/down arrows
- Cache read/write tokens and cache hit percentage behind icons
- Cost and subscription marker when applicable
- Context percentage, context window, and automatic compaction marker with a usage icon
- Session duration behind a clock icon
- Status values published by other extensions
- Active Pi tool count and configured plugin-package count beside the MCP status

The footer wraps segments onto additional rows when the terminal is narrow.

## Icons

Icons default to Nerd Font glyphs: `nf-md-robot_outline`, `nf-md-brain`,
`nf-md-folder_outline`, `nf-md-chart_donut`, `nf-md-arrow_up_bold`,
`nf-md-arrow_down_bold`, `nf-md-database_arrow_down`, `nf-md-database_arrow_up`,
`nf-md-database_check`, `nf-md-tools`, `nf-md-package_variant_closed`, `nf-md-timer_outline`, and `nf-fa-code_branch`.
If your terminal font does not include Nerd Font glyphs, switch to the ASCII
set with `"icons": "ascii"` in the theme config, or replace individual glyphs
with an object:

```json
{
  "icons": {
    "mode": "nerd",
    "model": "\uDB85\uDE7A",
    "thinking": "\uDB82\uDDD1",
    "path": "\uDB80\uDE56",
    "context": "\uDB81\uDFAF",
    "tokenInput": "\uDB81\uDF37",
    "tokenOutput": "\uDB81\uDF2E",
    "cacheRead": "\uDB85\uDE3B",
    "cacheWrite": "\uDB85\uDE3E",
    "cacheHit": "\uDB82\uDEA9",
    "toolCount": "\uDB84\uDC64",
    "pluginCount": "\uDB80\uDFD7",
    "sessionTime": "\uDB81\uDD1B",
    "gitBranch": "\uF126"
  }
}
```

Empty strings remove an icon and leave only the value.

## Install from npm

```bash
pi install npm:pi-simple-status-footer
```

After a new release, update the installed package with:

```bash
pi update npm:pi-simple-status-footer
```

Remove it with:

```bash
pi remove npm:pi-simple-status-footer
```

If you are switching from a local-folder installation, remove that source
before installing the npm package so Pi does not load both copies:

```bash
pi remove /path/to/pi-simple-status-footer
pi install npm:pi-simple-status-footer
```

For local development, install the project folder instead:

```bash
pi install /path/to/pi-simple-status-footer
```

On another computer, run the npm install command again to install the footer
without copying the source folder. Pi's user settings and the custom colors in
`~/.pi/agent/simple-status-footer.json` are separate from the package; migrate
your settings and theme file as well if you want the same customization.

Restart Pi or run `/reload` after installing or updating.

## Theme configuration

### Config file and overrides

The user config file is:

```text
~/.pi/agent/simple-status-footer.json
```

`PI_CODING_AGENT_DIR` changes the config directory. Package defaults are stored
in `footer-theme.default.json`; `simple-status-footer.json` overrides only the
fields it contains. You can start with a small file and add only the values you
want to customize:

```json
{
  "model": "#ff79c6",
  "provider": "#8be9fd",
  "tokens": "#f1fa8c",
  "cachePercent": "#50fa7b"
}
```

In this example, the model ID becomes pink, the provider name cyan, input/output
token counts yellow, and the cache-hit percentage green. Every other setting
continues to use the package defaults. Alternatively, copy
`footer-theme.example.json` to the config path to get a complete editable theme.

### Color fields

| Field | What it colors |
| --- | --- |
| `model` | Model ID, or `no-model` when no model is selected |
| `provider` | Provider name shown in parentheses |
| `thinking` | Current thinking level |
| `path` | Working directory and optional session name |
| `git` | Git branch and change counts when the worktree is clean |
| `gitDirty` | Git branch and change counts when there are changes |
| `tokens` | Input and output token counts |
| `cache` | Cache-read and cache-write token counts |
| `cachePercent` | Latest request's cache-hit percentage |
| `cost` | Accumulated cost and the subscription marker |
| `context` | Context usage up to 70%, and unknown usage |
| `contextWarn` | Context usage above 70%, up to 90% |
| `contextError` | Context usage above 90% |
| `sessionTime` | Session duration and tool/plugin counts beside the MCP row |
| `separator` | Separator between footer indicators |
| `background` | Optional background for footer and extension-status rows |

Color values can be Pi theme tokens (for example `"accent"`, `"success"`,
`"warning"`, `"error"`, `"muted"`), three- or six-digit hex colors, or ANSI
color indexes from 0 to 255. The default palette uses separate, restrained
colors for the model, provider, thinking level, path, tokens, cache, cost, and
session status. Git and context warning states retain their semantic colors.

### Other settings

| Field | Meaning | Range |
| --- | --- | --- |
| `icons` | `"nerd"`, `"ascii"`, or an object with per-icon overrides | Set an individual icon to `""` to hide it |
| `paddingLeft` | Left indentation for footer and extension-status rows | 0-8 cells; default 2 |
| `refreshMs` | Git status polling interval | 1000-60000 ms; default 5000 |

For example, set `"icons": "ascii"` for terminals without a Nerd Font, or
override one icon without replacing the others:

```json
{
  "icons": {
    "mode": "nerd",
    "cacheHit": "✓"
  },
  "paddingLeft": 1,
  "refreshMs": 10000
}
```

The MCP status row shows the active Pi tool count and the number of configured
plugin packages. A package can provide multiple extensions.

After editing the file, run `/reload` in Pi. Run `/status-theme-reset` to write
the package defaults to the user config; this replaces the current override
file, after which individual fields can be customized again.

## Development

Development dependencies target Pi 1.4.0. Use a Node.js version that supports
the `--experimental-strip-types` flag to run the tests.

```bash
git clone https://github.com/lonnnnnng/pi-simple-status-footer.git
cd pi-simple-status-footer
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## License

MIT. See [LICENSE](LICENSE).
