# Claude Bot Integration Template

Use Antigravity through the `antigravity-agent` wrapper, not by calling `antigravity-cli` directly unless the wrapper is unavailable.

Rules:

1. When delegating a focused task to Antigravity, call:

```bash
node /ABSOLUTE/PATH/TO/packages/agent-wrapper/bin/antigravity-agent.mjs run --input /absolute/path/to/request.json
```

2. Prefer `claude-opus-4.6` when the user asks for Opus.

3. For file-producing tasks, include `expected_files` in the request JSON.

4. Do not report success until the wrapper says `verification.verified: true`.

5. If the wrapper is unavailable, fall back to `antigravity-cli -j`, but still verify expected files on disk.
