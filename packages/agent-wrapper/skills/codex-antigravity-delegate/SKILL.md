---
name: antigravity-delegate
description: Use when delegating a bounded task to local Antigravity from Codex through the antigravity-agent wrapper. Prefer this for separate background work, especially when the task should create files in a workspace. Prefer claude-opus-4.6 when the user asks for Opus. Always include expected_files for file-producing tasks and verify those files before reporting success.
---

# Antigravity Delegate

Use this skill when you want Codex to hand a focused task to Antigravity instead of doing the task locally.

## Default behavior

1. Prefer `claude-opus-4.6` when the user asks for Opus.
2. Use the wrapper command, not raw `antigravity-cli`, unless the wrapper is unavailable.
3. For file-producing tasks, always include `expected_files`.
4. Do not report success until the expected files exist.

## Main command

```bash
node /ABSOLUTE/PATH/TO/packages/agent-wrapper/bin/antigravity-agent.mjs run \
  --task "..." \
  --cwd /absolute/workspace/path \
  --model claude-opus-4.6 \
  --expect-file OUTPUT_FILE
```

## JSON-file pattern

Prefer a JSON request file when the task text is long.

```json
{
  "task": "Create RESULT.md with a concise project summary.",
  "cwd": "/absolute/workspace/path",
  "model": "claude-opus-4.6",
  "approval_policy": "auto",
  "expected_files": ["RESULT.md"],
  "wait": true,
  "timeout_ms": 300000
}
```

Then run:

```bash
node /ABSOLUTE/PATH/TO/packages/agent-wrapper/bin/antigravity-agent.mjs run \
  --input /absolute/path/to/request.json
```

## Fallback

If the wrapper is unavailable, use `antigravity-cli -j` directly, but still verify the expected files before reporting completion.
