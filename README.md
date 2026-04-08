# antigravity-cli

> **Command Antigravity's Opus directly from the terminal.**
>
> Use Antigravity as a sub-agent from Claude Code, Codex, or any other agent.

- [Releases](https://github.com/professional-ALFIE/antigravity-cli/releases)
- [Changelog](./CHANGELOG.md)

## Quick Start

### One-liner Installation

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

## Screenshots

### 1. A prompt sent from the terminal lands in a real Antigravity session

<img src="screenshots/00-terminal-to-session-flow.png" width="520" alt="Terminal-to-session flow inside Antigravity" />

### 2. Launch three parallel sub-agents from inside Antigravity

<img src="screenshots/03-antigravity-running-cli-commands.png" width="520" alt="Antigravity launching three parallel CLI tasks" />

### 3. Result: three separate sessions are created

<img src="screenshots/07-three-background-sessions.png" width="520" alt="Three spawned sessions created from the parallel run" />

---

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

**Key:** Each invocation spawns a **fresh LS instance**. You do not need an IDE window to use it.

---

## Installation

### One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

What it does:
- clones or updates the repo under `~/.antigravity-cli/source`
- installs dependencies with `bun install`
- links `antigravity-cli` into `~/.local/bin`
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
antigravity-cli 'hello'                               # single-quoted message
antigravity-cli "hello"                               # double-quoted message
antigravity-cli 'say "hello" literally'               # inner double quotes preserved
antigravity-cli 'review this code'                    # create new conversation
antigravity-cli 'write tests' -m flash                # specify model
antigravity-cli -r                                    # list workspace sessions
antigravity-cli -r <cascadeId> 'continue'             # send message to existing session
antigravity-cli -b 'background task'                  # skip UI surfaced registration
antigravity-cli -j 'summarize this'                   # JSON output (JSONL to stdout)
antigravity-cli --help                                # show help
```

---

## Supported options

| Option | Description |
|--------|-------------|
| `"message"` | Create new conversation (single positional argument) |
| `-m, --model <model>` | Set conversation model (default from IDE last-used) |
| `-r, --resume` | List sessions |
| `-r, --resume [cascadeId] "message"` | Resume a session by cascadeId (UUID format) |
| `-b, --background` | Skip UI surfaced registration |
| `-j, --json` | Output transcript events as JSONL to stdout |
| `--timeout-ms <number>` | Override timeout in milliseconds (default: 120000) |
| `-h, --help` | Display help |

**Supported models:**
- `claude-opus-4.6`
- `claude-sonnet-4.6`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro`
- `gemini-3-flash`

If `--model` is omitted, the default follows `state.vscdb`'s IDE last-used model.

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

To continue this session, run antigravity-cli --resume 8ed28f7a-… '<message>'
```

When the provider returns user-facing trajectory errors, plain mode also streams those error messages to stderr as they arrive.

---

## How it works

```
┌─────────────────────────────────────────────────────┐
│                   antigravity-cli                    │
│                                                     │
│  argv → config → state.vscdb (auth + model)         │
│  → metadata.bin → fake extension server              │
│  → LS spawn → USS subscribe (auth handoff)           │
│  → StartCascade → stream + steps → transcript       │
│  → post-processing → cleanup                         │
└──────────────────────┬──────────────────────────────┘
                       │ ConnectRPC (HTTPS)
                       ▼
┌─────────────────────────────────────────────────────┐
│         language_server_macos_arm (LS binary)        │
│         from Antigravity.app                         │
└─────────────────────────────────────────────────────┘
```

1. Reads **`state.vscdb`** for OAuth tokens, model preferences, and USS topic bytes
2. Spawns the **LS binary** from `Antigravity.app` with protobuf metadata via stdin
3. **Fake extension server** handles reverse RPC (USS subscriptions, heartbeat)
4. **ConnectRPC** over HTTPS (self-signed `cert.pem`) to the spawned LS
5. Streams agent state updates; fetches trajectory steps as conversation progresses
6. Post-processing: `UpdateConversationAnnotations` + `trajectorySummaries` hydration for IDE visibility

**No Bridge Extension. No IDE window required.** Talks to the LS binary directly.

---

## Notes

- If `--model` is omitted, the default follows `state.vscdb`'s IDE last-used model.
- `--background` skips UI surfaced registration (no `trajectorySummaries` hydration).
- Messages must be a single positional argument. Use quotes for spaces.
- Prefer single quotes for literal text; use double quotes inside them for emphasis.
- Antigravity.app must be installed and signed in at least once (for `state.vscdb`).
- Each invocation spawns a **fresh LS instance** (1:1 one-shot model).

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
