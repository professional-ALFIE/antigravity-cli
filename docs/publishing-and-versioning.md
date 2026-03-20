# Publishing and Versioning

This guide explains how to put this project on GitHub and version it.

## Recommended GitHub flow

If the original project belongs to someone else, the safest path is:

1. fork the original repo to your account
2. push your branch to your fork
3. open a pull request

That keeps history clean and makes upstream contribution easier.

## Recommended branch naming

Use a feature branch, for example:

```bash
git checkout -b codex/agent-wrapper-v1
```

## Recommended version

This feature set adds new behavior without intentionally replacing the main CLI UX.

That makes `0.2.0` a good version:

- new agent wrapper
- job-based agent workflow
- approval policy support
- stronger workspace recovery
- new docs for humans and AI agents

## Versioned files

For this release, the important versioned files are:

- `packages/cli/package.json`
- `packages/extension/package.json`
- `packages/agent-wrapper/package.json`
- `CHANGELOG.md`

## Example release flow

```bash
git checkout -b codex/agent-wrapper-v1
git add .
git commit -m "Add agent wrapper and agentic workflow docs"
git push -u origin codex/agent-wrapper-v1
```

After merging to `main`:

```bash
git checkout main
git pull origin main
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

## GitHub release

After pushing the tag:

1. open GitHub Releases
2. draft a release from `v0.2.0`
3. copy the user-facing changes from `CHANGELOG.md`

## Beginner rule

Do not tag first and fix docs later.

Prepare docs, tests, versions, and release notes first.
Then push branch.
Then tag the release when the branch is ready.
