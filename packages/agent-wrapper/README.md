# Agent Wrapper for Antigravity

This package is the beginner-friendly layer that sits on top of `antigravity-cli`.

If you remember only one thing, remember this:

- `antigravity-cli` is the low-level engine
- `antigravity-agent` is the simpler wrapper other agents should call
- MCP is optional and should sit on top of `antigravity-agent`, not replace it

## Why this package exists

`antigravity-cli` is already powerful, but it is still a little too low-level for other agents.

Other agents usually need a simpler contract:

- send one task
- wait for completion
- make sure expected files really exist
- get machine-readable JSON back

That is exactly what `antigravity-agent` does.

## Simple mental model

Think of the system as three layers:

### Layer 1: `antigravity-cli`

This is the real worker.

It knows how to:

- connect to the Bridge
- create Antigravity sessions
- resume sessions
- wait on jobs
- talk to the running Antigravity app

### Layer 2: `antigravity-agent`

This package is the translator for AI agents.

It gives agents a simpler interface:

- `run`
- `wait`
- `models`
- `doctor`

It also adds one very important safety feature:

- verify that expected files exist before reporting success

That matters because a job can sometimes look "done" slightly before the file appears on disk.

### Layer 3: MCP server (optional, later)

MCP is not the same thing as the CLI.

MCP is just a way for tools like Codex, Claude, or OpenClaw to call a program in a standard way.

So the clean design is:

1. Keep `antigravity-cli` as the engine
2. Keep `antigravity-agent` as the stable wrapper
3. If you want MCP later, build the MCP server so it calls `antigravity-agent`

That way:

- the CLI stays focused
- the agent wrapper stays simple
- the MCP server stays thin

## Files in this package

- `bin/antigravity-agent.mjs`
  The wrapper command.
- `examples/diet-plan-request.json`
  A real example request file.
- `skills/codex-antigravity-delegate/SKILL.md`
  A Codex skill that tells Codex how to use this wrapper.
- `templates/claude-bot-instructions.md`
  A plain-text template for Claude-based agents.
- `templates/openclaw-instructions.md`
  A plain-text template for OpenClaw-style integrations.

## How to use it

### 1. Check that the wrapper can reach the CLI

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs doctor
```

### 2. See the supported models

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs models
```

### 3. Run a task directly

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs run \
  --task "Create DIET_PLAN.md with a 7-day healthy meal plan." \
  --cwd /tmp/ag-diet-plan \
  --model claude-opus-4.6 \
  --expect-file DIET_PLAN.md
```

### 4. Run from a JSON file

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs run \
  --input packages/agent-wrapper/examples/diet-plan-request.json
```

### 5. Wait on an existing job

```bash
node packages/agent-wrapper/bin/antigravity-agent.mjs wait \
  --job JOB_ID_HERE \
  --cwd /tmp/ag-diet-plan \
  --expect-file DIET_PLAN.md
```

## JSON request format

The wrapper accepts a JSON file with this shape:

```json
{
  "task": "Write a 7-day diet plan in DIET_PLAN.md",
  "cwd": "/tmp/ag-diet-plan",
  "model": "claude-opus-4.6",
  "approval_policy": "auto",
  "expected_files": ["DIET_PLAN.md"],
  "wait": true,
  "timeout_ms": 300000
}
```

## Why the separation is important

If you let every agent talk to `antigravity-cli` differently, you get three problems:

- duplicated logic
- inconsistent prompts
- fragile file verification

By keeping one wrapper in the middle, all agents behave the same way.

That is the main idea.

## Recommendation for each agent

### Codex

Use the Codex skill in `skills/codex-antigravity-delegate/SKILL.md`.

### Claude bot

Use the template in `templates/claude-bot-instructions.md`.

### OpenClaw

Use the template in `templates/openclaw-instructions.md`.

## Important beginner note

You do **not** need to understand MCP first.

Start with this order:

1. Learn `antigravity-cli`
2. Use `antigravity-agent`
3. Add MCP only when you want other tools to call the wrapper automatically

That keeps the system easier to learn and easier to debug.
