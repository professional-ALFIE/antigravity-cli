**[English](./README.md)** | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [中文](./docs/README.zh.md)

# antigravity-cli

> **Command Antigravity's Opus directly from the terminal.**
>
> Use Antigravity as a sub-agent from Claude Code, Codex, or any other agent.

## Demo

<div align="center">
  <img src="docs/screenshots/screen-recoding-2026-04-12-02.55.33.gif" alt="antigravity-cli demo — terminal to Antigravity session" />
</div>

- [Releases](https://github.com/professional-ALFIE/antigravity-cli/releases)
- [Changelog](./CHANGELOG.md)

## Highlights

- **Transcripts saved per project** — `~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl`, following [Claude Code](https://docs.anthropic.com/en/docs/claude-code)'s convention. Grep, replay, or pipe just like Claude sessions.
- **`--json` streams in real time** — JSONL events are emitted to stdout as each step arrives, so you can pipe them into anything (Telegram bots, log aggregators, dashboards, etc.).

## Evolution

| Version | Approach |
|---------|----------|
| **v0.1.0** | Extension → Bridge HTTP API → SDK |
| **v0.1.3** | Offline-only — spawn own LS, no IDE required |
| **v0.2.0** | **Hybrid** — live sync when IDE is running(!), offline spawn when it's not(!!) |
| **v0.3.0** | **Hybrid + quota orchestration** — selective auth refresh, post-prompt rotate, wake-up, fingerprint, verified offline fast-path |

## Quick Start

### One-liner Installation

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

## Why?

### 1. Legitimately leverage your Antigravity quota

Antigravity Pro/ULTRA gives you **Opus**, but only inside the IDE.

Tools like OpenClaw, proxies, and opencode tried to extract Antigravity's OAuth token for external use — **Google mass-banned those accounts.** Some even lost access to Gmail and Workspace.

**This CLI does not extract any tokens.** It spawns the IDE's own language server directly and replays the local auth handoff from `state.vscdb`. Account ban risk? Zero.

### 2. Summon Antigravity as a sub-agent from other agents

While working in Claude Code or Codex:

```bash
# Delegate a task to Antigravity's Opus from another agent
antigravity-cli "refactor this module"
antigravity-cli -b "write test code"     # skip UI surfaced registration
```

While your main agent focuses on the primary task, **Antigravity handles sub-tasks in parallel.**

### 3. Isolate context within Antigravity itself

Long sessions in Antigravity lead to:
- **Context explosion** — cramming too many tasks into one conversation burns through tokens and degrades quality
- **Flow disruption** — squeezing in "just this one thing" tangles the context

With this CLI you can spawn a separate sub-agent, **keeping your main conversation context clean.**

*Don't cram everything into a single agent. Manage your context efficiently.*

---

## What does it do?

| Command | → | Effect |
|---------|---|--------|
| `antigravity-cli "refactor this"` | → | **New session** created, waits for the response |
| `antigravity-cli -r` | → | **List sessions** for current workspace |
| `antigravity-cli -r <cascadeId> "continue"` | → | **Resume** existing session |
| `antigravity-cli -b "quick answer"` | → | **Skip UI surfaced registration** |
| `antigravity-cli -j "summarize this"` | → | **Emit JSONL transcript events** |
| `antigravity-cli auth list` | → | **List accounts** with GEMINI/CLAUDE quota status |
| `antigravity-cli auth login` | → | **Add a new managed account** via Antigravity app |

**Key:** If Antigravity IDE is running, the CLI **attaches to the live LS** for instant UI sync. Otherwise it **spawns its own LS** with a built-in extension shim — no IDE window required.

---

## Installation

### One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

What it does:
- clones or updates the repo under `~/.antigravity-cli/source`
- installs dependencies with `bun install`
- links `antigravity-cli` and `agcl` (short alias) into `~/.local/bin`
- verifies the install with `antigravity-cli --help`

**Required:** macOS, Antigravity.app installed, Antigravity already signed in at least once, Git, Bun

> **Update?** Just run the same command again.

### Manual installation

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

---

## Usage

```bash
antigravity-cli 'hello'                               # or: agcl 'hello'
antigravity-cli "hello"                               # or: agcl "hello"
antigravity-cli hello world                           # unquoted — joined automatically
antigravity-cli 'review this code'                    # create new conversation
antigravity-cli 'write tests' --model flash           # or: agcl -m flash 'write tests'
antigravity-cli -r                                    # or: agcl -r ⭢ list workspace sessions
antigravity-cli -r <cascadeId> 'continue'             # or: agcl -r <cascadeId> 'continue'
antigravity-cli --background 'quick task'             # or: agcl -b 'quick task'
antigravity-cli --json 'summarize this'               # or: agcl -j 'summarize this' ⭢ JSONL to stdout
antigravity-cli --help                                # or: agcl -h

# Account management
antigravity-cli auth list                             # or: agcl auth list ⭢ show accounts + quota
antigravity-cli auth login                            # or: agcl auth login ⭢ add new managed account

# Stdin pipe — avoids shell escaping issues (!, ", etc.)
echo "hello!" | antigravity-cli
cat prompt.txt | antigravity-cli
antigravity-cli -                                     # explicit stdin marker
```

---

## Supported options

| Option | Description |
|--------|-------------|
| *(no `--model`)* | **Auto-follows IDE last-used model** — whatever you last picked in Antigravity IDE is the default |
| `"message"` | Create new conversation (single positional argument) |
| `-m, --model <model>` | Set conversation model (default from IDE last-used) |
| `-r, --resume` | List sessions |
| `-r, --resume [cascadeId] "message"` | Resume a session by cascadeId (UUID format) |
| `-b, --background` | Skip UI surfaced registration |
| `-j, --json` | Output transcript events as JSONL to stdout |
| `--timeout-ms <number>` | Override timeout in milliseconds (default: 120000) |
| `-h, --help` | Display help |
| `auth list` | List accounts with GEMINI/CLAUDE quota progress bars |
| `auth login` | Add a new managed account via Antigravity app |

**Supported models:**
- `claude-opus-4.6`
- `claude-sonnet-4.6`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro`
- `gemini-3-flash`

If `--model` is omitted, the CLI **automatically uses the model you last selected in Antigravity IDE** (read from `state.vscdb`). Switch models in the IDE and the CLI follows — no flag needed.

---

## Transcript

Every conversation is automatically saved as JSONL — regardless of `--json`.

```
~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl
```

The official Antigravity IDE does not expose transcripts. This CLI follows [Claude Code](https://docs.anthropic.com/en/docs/claude-code)'s convention (`~/.claude/projects/…/<sessionId>.jsonl`) so you can replay, grep, or pipe conversation history the same way.

After each plain-mode session, the CLI prints:

```
cascadeId: 8ed28f7a-…
transcript_path: ~/.antigravity-cli/projects/-Users-…/8ed28f7a-….jsonl

To continue this session, run antigravity-cli -r 8ed28f7a-… '<message>'
```

When the provider returns user-facing trajectory errors, plain mode also streams those error messages to stderr as they arrive.

---

## How it works

The CLI discovers the execution path automatically:

```
                      antigravity-cli
                            │
                  argv / config / model
                            │
               discover live Language Server
                            │
                 ┌──────────┴──────────┐
                 │                     │
           LS running?            LS not found?
                 │                     │
          ⭢ Live Sync           ⭢ Offline Spawn
                 │                     │
          attach to IDE's         spawn own LS +
          existing LS             extension shim
                 │                     │
                 └──────────┬──────────┘
                            │
                 ConnectRPC (HTTPS)
                            │
                 StartCascade → stream
                 → steps → transcript
```

### Path A — Live Sync (IDE running)

1. Discovers the running LS via process introspection (`ps` + `lsof`)
2. Extracts CSRF token and HTTPS port from the live discovery file
3. **ConnectRPC** directly to the existing LS — no spawn, no fake server
4. Conversation appears in IDE UI immediately
5. `state.vscdb` is **not touched** — the IDE owns its own DB

### Path B — Offline Spawn (no IDE)

1. Reads **`state.vscdb`** for OAuth tokens, model preferences, and USS topic bytes
2. Spawns the **LS binary** from `Antigravity.app` with protobuf metadata via stdin
3. **Built-in extension shim** handles reverse RPC (USS auth handoff, heartbeat)
4. **ConnectRPC** over HTTPS (self-signed `cert.pem`) to the spawned LS
5. Streams agent state updates; fetches trajectory steps as conversation progresses
6. Post-processing: `trajectorySummaries` hydration to `state.vscdb` for later IDE visibility

**No Bridge Extension.** Talks to the LS binary directly — with or without an IDE window.

---

## Notes

- If `--model` is omitted, the CLI **auto-follows the IDE's last-used model** — switch in the IDE, the CLI follows.
- `--background` skips UI surfaced registration (no `trajectorySummaries` hydration).
- Multiple positional arguments are joined with spaces automatically — quotes are optional.
- Stdin pipe (`echo "prompt" | agcl`) avoids shell escaping issues with `!`, `"`, etc.
- Antigravity.app must be installed and signed in at least once (for `state.vscdb`).
- If the IDE is running, the CLI attaches to the **live LS**. Otherwise it spawns a **fresh LS instance** (1:1 one-shot).

---

## Contributors

This project was built together with AI agents.

| | Role |
|---|------|
| **[professional-ALFIE](https://github.com/professional-ALFIE)** | Design, direction, verification |
| **[Antigravity](https://antigravity.google)** | Implementation, debugging, refactoring |
| **[Codex](https://openai.com/codex)** | Protobuf analysis, code review |

---

## License

AGPL-3.0-or-later
