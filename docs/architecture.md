# Architecture Guide

This file explains the project in beginner-friendly language.

## The short version

There are now three layers:

1. `antigravity-cli`
2. `antigravity-agent`
3. MCP server later, if you want one

They are not the same thing.

## Layer 1: `antigravity-cli`

This is the low-level engine.

It knows how to:

- find the right Antigravity workspace
- connect to the Bridge extension
- create or resume Antigravity sessions
- wait on jobs
- drive approval steps when needed

If something is broken at the Antigravity connection level, this is usually where the fix belongs.

## Layer 2: `antigravity-agent`

This is the new wrapper for AI agents.

It sits on top of `antigravity-cli` and makes the interface simpler.

Instead of every AI agent inventing its own command style, the wrapper gives a small stable tool surface:

- `doctor`
- `models`
- `run`
- `wait`

It also adds file verification.

That matters because a task can sometimes look complete before the expected file appears on disk.

## Layer 3: MCP server

MCP is optional.

MCP is not a replacement for the CLI or the wrapper.

MCP is a standard way for tools like Codex, Claude, or OpenClaw to call another program.

The clean design is:

```text
AI agent
  -> MCP tool (optional)
  -> antigravity-agent
  -> antigravity-cli
  -> Bridge extension
  -> Antigravity app
```

## Why the separation is good

This separation keeps each part simple:

- `antigravity-cli` focuses on talking to Antigravity
- `antigravity-agent` focuses on stable agent workflows
- MCP, if added, focuses on standard tool exposure

If you skip this separation, three different agent systems start talking to the CLI in three different ways, which becomes harder to debug.

## Beginner mental model

Think of it like this:

- `antigravity-cli` is the engine
- `antigravity-agent` is the steering wheel
- MCP is the remote control adapter

The engine does the real work.
The steering wheel gives humans and agents a safer interface.
The remote control adapter is only needed when another platform wants a standard protocol.
