# Human Guide

This guide is for a human operator who wants to use the project directly.

## Start here

If you are new, learn the tools in this order:

1. `antigravity-cli`
2. `antigravity-agent`
3. MCP later, only if you need it

## Core commands

### Low-level CLI

```bash
antigravity-cli "review this code"
antigravity-cli -a "write tests"
antigravity-cli -r
antigravity-cli -r SESSION_UUID "continue"
antigravity-cli server status
```

### Agent wrapper

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs doctor
node packages/agent-wrapper/bin/antigravity-agent.mjs models
node packages/agent-wrapper/bin/antigravity-agent.mjs run \
  --task "Create RESULT.md with a short summary." \
  --cwd /tmp/ag-demo \
  --model claude-opus-4.6 \
  --expect-file RESULT.md
```

## Choosing a model

Supported CLI model names:

- `claude-opus-4.6`
- `claude-sonnet-4.6`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro`
- `gemini-3-flash`

Useful aliases:

- `opus`
- `sonnet`
- `pro-high`
- `pro`
- `flash`

If you want Opus, use:

```bash
antigravity-cli -m claude-opus-4.6 "your task"
```

or through the wrapper:

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs run \
  --task "your task" \
  --cwd /absolute/path \
  --model claude-opus-4.6
```

## Why use the wrapper?

Use `antigravity-agent` when:

- another AI agent is calling Antigravity
- you want JSON output
- you want expected file verification
- you want a more stable contract than raw CLI text

Use raw `antigravity-cli` when:

- you are using it directly as a person
- you want full low-level control

## Common workflow

### Example: create a file and verify it

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs run \
  --task "Create DIET_PLAN.md with a 7-day diet plan." \
  --cwd /tmp/ag-diet-plan \
  --model claude-opus-4.6 \
  --expect-file DIET_PLAN.md
```

The wrapper will:

1. submit the job
2. wait for it
3. check that `DIET_PLAN.md` really exists
4. return JSON

## Important troubleshooting note

If GitHub, Codex, Claude, or another tool is calling this project automatically, prefer the wrapper instead of parsing spinner output from `antigravity-cli`.
