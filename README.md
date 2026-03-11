# antigravity-cli

> **Command Antigravity's Opus directly from the terminal.**
>
> Use Antigravity as a sub-agent from Claude Code, Codex, or any other agent.

- [Releases](https://github.com/professional-ALFIE/antigravity-cli/releases)
- [Changelog](./CHANGELOG.md)

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

**This CLI does not extract any tokens.** It calls the IDE's own API through a legitimate Bridge Extension running inside the IDE. Account ban risk? Zero.

### 2. Summon Antigravity as a sub-agent from other agents

While working in Claude Code or Codex:

```bash
# Delegate a task to Antigravity's Opus from another agent
antigravity-cli "refactor this module"
antigravity-cli -a "write test code"     # fire-and-forget
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
| `antigravity-cli "refactor this"` | → | **New session** created, runs in background |
| `antigravity-cli -r` | → | **List sessions** for current workspace |
| `antigravity-cli -r UUID "continue"` | → | **Resume** existing session |
| `antigravity-cli -a "quick answer"` | → | **Fire-and-forget** — exit without waiting |
| `antigravity-cli server status` | → | Bridge connection + user **status** |

**Key:** The main conversation view in the IDE is **not changed.**

---

## Installation

### One-liner

```bash
curl -sL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

Builds the SDK → packages the Bridge Extension → installs into IDE → configures CLI — **fully automated.**

**Required:** Git, Node.js 18+, npm
**Recommended:** [bun](https://bun.sh) — significantly faster CLI execution

> **Update?** Just run the same command again.

### Manual installation

```bash
git clone https://github.com/professional-ALFIE/antigravity-cli.git ~/.antigravity-cli/source
cd ~/.antigravity-cli/source
npm install
npm -w packages/sdk run build
npm -w packages/extension run build
cd packages/extension && yes | npx @vscode/vsce package --no-dependencies && cd ../..
# Install Extension into Antigravity IDE
/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity --install-extension packages/extension/*.vsix --force
```

---

## Usage

### Spawn a sub-agent (default mode)

```bash
antigravity-cli "review this code"                       # new conversation
antigravity-cli "write tests" -m flash                   # specify model
antigravity-cli -a "quick analysis"                      # fire-and-forget
antigravity-cli -r                                       # list workspace sessions
antigravity-cli -r SESSION_UUID "continue where we left" # resume session
```

### Server management

```bash
antigravity-cli server status                            # server + user status
antigravity-cli server prefs                             # agent preferences
antigravity-cli server auto-run status                   # auto-run patch status
```

### Execute internal commands directly

```bash
antigravity-cli commands list                            # 140+ internal commands
antigravity-cli commands exec antigravity.getDiagnostics # execute directly
```

---

## Full command reference

### Root mode (default conversation)

| Option | Description |
|--------|-------------|
| `"message"` | Create new conversation |
| `-m, --model <model>` | Set conversation model |
| `-r, --resume` | List workspace sessions |
| `-r, --resume [uuid] "message"` | Resume existing session |
| `-a, --async` | Fire-and-forget |
| `-j, --json` | Output in JSON format |
| `-p, --port <port>` | Manually specify Bridge server port |

**Supported models:**
- `claude-opus-4.6` (default)
- `claude-sonnet-4.6`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro`
- `gemini-3-flash`

### server

| Subcommand | Description |
|------------|-------------|
| `server status` | Server connection + user status |
| `server prefs` | Agent preferences |
| `server diag` | System diagnostics |
| `server monitor` | Real-time event stream (Ctrl+C to stop) |
| `server state [key]` | Internal store lookup |
| `server reload` | Reload IDE window |
| `server restart` | Restart language server |
| `server auto-run status` | Check auto-run patch status |
| `server auto-run apply` | Manually apply auto-run patch |
| `server auto-run revert` | Restore original files |

### agent

| Subcommand | Description |
|------------|-------------|
| `agent workflow` | Create workspace workflow |
| `agent workflow --global` | Create global workflow |
| `agent rule` | Create agent rule |

### commands

| Subcommand | Description |
|------------|-------------|
| `commands list` | List internal commands (140+) |
| `commands exec <cmd> [args...]` | Execute internal command directly |

---

## How it works

```
┌─────────────────────────────────────────────────┐
│              Antigravity IDE                     │
│                                                 │
│   ┌──────────────────────────────────────────┐  │
│   │     Bridge Extension (auto-installed)     │  │
│   │                                          │  │
│   │   antigravity-sdk ──▶ REST API exposed  │  │
│   │   127.0.0.1:PORT    (localhost only)     │  │
│   └───────────────▲──────────────────────────┘  │
│                   │                             │
└───────────────────┼─────────────────────────────┘
                    │ HTTP (localhost)
┌───────────────────┼─────────────────────────────┐
│   antigravity-cli ┘                             │
│                                                 │
│   $ antigravity-cli "refactor this"             │
│   $ antigravity-cli -r                          │
│   $ antigravity-cli server status               │
└─────────────────────────────────────────────────┘
```

1. **Bridge Extension** runs an HTTP server inside the IDE (auto-installed)
2. **CLI** sends requests to that server from the terminal
3. New conversations are created in the **background** — main view unchanged
4. On macOS, if Antigravity is running, **new workspace windows are automatically minimized**

**No OAuth token extraction.** The SDK is called normally within the IDE process.

### Workspace auto-connection

The CLI automatically figures out which Antigravity workspace to talk to based on your current terminal path:

| Scenario | What happens |
|----------|-------------|
| **Workspace already open** in Antigravity | CLI connects to that workspace's Bridge — runs as if you were inside that workspace's terminal |
| **Antigravity is running** but the workspace isn't open | CLI launches a **new workspace window minimized** in the background, waits for the Bridge to become ready, then connects |
| **Antigravity is not running** at all | CLI exits with a clear error asking you to start Antigravity |

This means you can `cd` into any project directory and just run `antigravity-cli` — it will find or create the right workspace automatically. Subsequent runs connect instantly because the workspace stays open.

---

## Repository structure

This repository is a monorepo. `install.sh` builds everything automatically.

| Package | Role |
|---------|------|
| `packages/sdk` | antigravity-sdk local fork (protobuf patches) |
| `packages/extension` | Bridge VS Code Extension (.vsix) |
| `packages/cli` | antigravity-cli itself |

---

## Implemented / Hidden commands

The following commands are implemented but hidden from the default `--help` output.

| Command / Option | Description | Note |
|------------------|-------------|------|
| `accept` | Accept pending step | Handled automatically with auto-run ON |
| `reject` | Reject pending step | Handled automatically with auto-run ON |
| `run` | Run pending terminal command | Handled automatically with auto-run ON |
| `ui install` | Install Agent View UI elements | Internal maintenance |
| `--idle-timeout <ms>` | Root conversation mode idle timeout | Advanced debugging |

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
