# AI Agent Integration Guide

This guide is for agent builders.

## Recommended contract

Do not make each agent call `antigravity-cli` in a custom way.

Instead:

1. call `antigravity-agent`
2. pass structured inputs
3. require expected files for file-producing tasks
4. treat the wrapper JSON as the source of truth

## Preferred flow

```text
AI agent
  -> antigravity-agent run
  -> antigravity-agent wait
  -> inspect JSON result
```

## Request shape

Use this JSON structure:

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

## Why `expected_files` matters

Antigravity can sometimes finish a job slightly before the file becomes visible on disk.

That means agent integrations should not trust job status alone for file-producing tasks.

The wrapper solves that by verifying the file path directly.

## Codex

Use:

- `packages/agent-wrapper/skills/codex-antigravity-delegate/SKILL.md`

The skill tells Codex:

- when to delegate
- how to call the wrapper
- how to verify file output

## Claude bot

Use:

- `packages/agent-wrapper/templates/claude-bot-instructions.md`

## OpenClaw

Use:

- `packages/agent-wrapper/templates/openclaw-instructions.md`

## Future MCP design

If you add MCP later, the MCP server should call `antigravity-agent`, not `antigravity-cli` directly.

That gives you one integration contract for all agent systems.

## Suggested MCP tools later

- `list_models`
- `doctor`
- `run_task`
- `wait_job`

Each of those should be a thin pass-through to the wrapper.
