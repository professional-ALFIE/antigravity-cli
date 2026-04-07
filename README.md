# antigravity-cli

> Headless Antigravity CLI that talks to the language server directly.

## Installation

### One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

What it does:
- clones or updates the repo under `~/.antigravity-cli/source`
- installs dependencies with `bun install`
- links `antigravity-cli` into `~/.local/bin`

Required:
- macOS
- Antigravity.app installed
- Antigravity already signed in at least once
- Git
- Bun

### Manual install

```bash
git clone https://github.com/professional-ALFIE/antigravity-cli.git ~/.antigravity-cli/source
cd ~/.antigravity-cli/source
bun install
chmod +x src/main.ts src/entrypoints/cli.ts
mkdir -p ~/.local/bin
ln -sf ~/.antigravity-cli/source/src/entrypoints/cli.ts ~/.local/bin/antigravity-cli
```

If `~/.local/bin` is not on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Usage

```bash
antigravity-cli 'hello'
antigravity-cli "hello"
antigravity-cli 'say "hello" literally'
antigravity-cli -r
antigravity-cli -r SESSION_UUID 'continue'
antigravity-cli -b 'background task'
antigravity-cli -j 'summarize this'
antigravity-cli --help
```

## Supported options

- `-m, --model <model>`
- `-r, --resume`
- `-b, --background`
- `-j, --json`
- `--timeout-ms <number>`
- `-h, --help`

## Notes

- If `--model` is omitted, the default follows `state.vscdb`'s IDE last-used model.
- `--background` skips UI surfaced registration.
- Messages must be a single positional argument. Use quotes for spaces.
