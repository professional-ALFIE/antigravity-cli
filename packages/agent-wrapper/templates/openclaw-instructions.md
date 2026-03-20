# OpenClaw Integration Template

Treat `antigravity-agent` as the stable external tool for Antigravity delegation.

Recommended flow:

1. Build a JSON request with:
   - `task`
   - `cwd`
   - `model`
   - `approval_policy`
   - `expected_files`
   - `wait`
   - `timeout_ms`

2. Execute:

```bash
node /ABSOLUTE/PATH/TO/packages/agent-wrapper/bin/antigravity-agent.mjs run --input /absolute/path/to/request.json
```

3. Read the JSON response.

4. Only mark the task successful if:
   - `ok` is `true`
   - and `verification.verified` is `true` when file output is expected

5. Prefer `claude-opus-4.6` when the user asks for Opus.
