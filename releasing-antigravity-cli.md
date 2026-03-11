---
name: releasing-antigravity-cli
description: Release workflow for the antigravity-cli monorepo. Use this whenever the user asks to bump the version, cut a release, update CHANGELOG.md, package the Bridge Extension, reinstall the VSIX, push a tag, create or update a GitHub Release, or verify release state for this repository. This skill is repository-specific and should be used even if the user only mentions one part of the release flow, such as "version up", "tag this", "publish v0.1.2", or "make the release page show content."
compatibility:
  tools:
    - git
    - gh
    - npm
    - node
    - npx
    - bash
  platform:
    - macOS
---

# Releasing antigravity-cli

Use this skill to complete a release for this repository end to end.

The goal is not just to push a tag. The goal is to leave the repository, GitHub Releases page, local CLI install, and Antigravity IDE extension in a consistent state.

## What this repository expects

This release flow is specific to this repository.

- The root workspace is a private monorepo.
- The CLI version lives in `packages/cli/package.json`.
- The Bridge Extension version lives in `packages/extension/package.json`.
- The CLI `--version` output is hardcoded in `packages/cli/bin/antigravity-cli.ts`.
- The CLI version test is hardcoded in `packages/cli/test/help-surface.test.ts`.
- Workspace package versions also appear in the root `package-lock.json`.
- User-visible release notes live in `CHANGELOG.md`.
- `CHANGELOG.md` and GitHub Release notes should be written in English.
- `CHANGELOG.md` should follow a Quotio-style structure: version heading with date, then sections such as `Added`, `Changed`, `Fixed`, and an optional `Release metadata` block.
- `README.md` should expose release and changelog links.
- The Bridge Extension is packaged as a `.vsix` from `packages/extension/`.
- The local wrapper `antigravity-cli` points at `$HOME/.antigravity-cli/source/packages/cli/bin/antigravity-cli.ts`.
- After pushing a release, the installed source at `$HOME/.antigravity-cli/source` should be fast-forwarded so local usage matches the repo.

## Inputs to determine first

Determine these before editing anything:

- Target version, for example `0.1.2`
- Release type: patch, minor, or major
- Whether the tag already exists
- Whether a GitHub Release already exists for that tag
- Whether `CHANGELOG.md` already has a section for that version
- Which app performed the release work, if known
- Which model performed the release work, if known

Use this shell pattern:

```bash
version_to_release_var="0.1.2"   # string
tag_name_var="v${version_to_release_var}"   # string
```

Do not move or overwrite an existing tag unless the user explicitly asks for that.

## Files that usually change

Update these files for a normal CLI + Extension release:

- `packages/cli/package.json`
- `packages/extension/package.json`
- `packages/cli/bin/antigravity-cli.ts`
- `packages/cli/test/help-surface.test.ts`
- `package-lock.json`
- `CHANGELOG.md`
- `README.md` if release or changelog links are missing
- `plan.md` because this repository expects it to stay updated

Do not bump `packages/sdk/package.json` unless the user explicitly wants to release the SDK package itself.

## Release checklist

Follow this order.

### 1. Inspect the current state

Run:

```bash
git status --short
git branch --show-current
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git tag --list --sort=-creatordate | head
gh release view "$tag_name_var" --json tagName,name,url 2>/dev/null || true
```

Check the currently installed CLI too:

```bash
antigravity-cli -v
which antigravity-cli
```

### 2. Update version strings

Apply the new version consistently.

- `packages/cli/package.json`
- `packages/extension/package.json`
- `packages/cli/bin/antigravity-cli.ts`
- `packages/cli/test/help-surface.test.ts`
- `package-lock.json`

Do not leave `0.1.1` in one file and `0.1.2` in another.

### 3. Update release documentation

Write `CHANGELOG.md` in English and keep the structure close to Quotio-style versioned release notes. Use a version heading with a date, then short change sections.

Update `CHANGELOG.md` in a versioned style like this:

```markdown
## [0.1.2] - 2026-03-11

### Added
- ...

### Fixed
- ...

### Changed
- ...

### Release metadata
- GitHub release record: `v0.1.2`
- via APP_NAME_VAR, MODEL_NAME_VAR
```

Rules for the release metadata line:

- Keep this metadata as the final bullet of the version section.
- Use the actual app and model only if they are known from the current session, user input, or verifiable local context.
- If only the app is known, write only the app, for example `- via Codex App`.
- If only the model is known, write only the model, for example `- via GPT-5.4`.
- If neither is known, omit the metadata line entirely.
- Never invent app or model values.

If `README.md` does not already expose release discovery, add links near the top:

- `Releases`
- `Changelog`

Also update `plan.md` if the repository history for this release should be recorded there.

### 4. Verify the release candidate

Prefer the full checks first:

```bash
npm -w packages/cli test
node --import tsx --test packages/extension/test/*.test.ts
npm run build
```

If the full CLI suite fails because of pre-existing unrelated failures, do not hide that fact. Report the exact failing tests.

If the user still wants to proceed with the release and the failures are unrelated to the version bump or release path, run the narrower checks that protect the release surface:

```bash
cd packages/cli && node --import tsx --test test/help-surface.test.ts test/model-resolver.test.ts
cd /Users/noseung-gyeong/Dropbox/meta-agent/issue-24-antigravity-sdk
node --import tsx --test packages/extension/test/*.test.ts
npm run build
```

### 5. Package and reinstall the Bridge Extension

Package the `.vsix`:

```bash
cd packages/extension
(yes 2>/dev/null || true) | npx -y @vscode/vsce package --no-dependencies
cd /Users/noseung-gyeong/Dropbox/meta-agent/issue-24-antigravity-sdk
```

Install it into Antigravity IDE:

```bash
/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity --install-extension "packages/extension/antigravity-bridge-extension-${version_to_release_var}.vsix" --force
```

If packaging succeeds, the `.vsix` can also be attached to the GitHub Release.

### 6. Commit the release changes

Use a Korean commit message with the repository's prefix style.

Typical split:

- Release prep or fix commits first, if there are real code changes
- Then the version bump commit, for example:

```bash
git add package-lock.json packages/cli/bin/antigravity-cli.ts packages/cli/package.json packages/cli/test/help-surface.test.ts packages/extension/package.json
git commit -m "chore: ${version_to_release_var} 버전 업"
```

- Then docs if `CHANGELOG.md` or README changed separately:

```bash
git add CHANGELOG.md README.md plan.md
git commit -m "docs: changelog 및 릴리즈 링크 추가"
```

Keep the commits logical. Do not squash user changes you did not make.

### 7. Push source commits

Run:

```bash
git push origin main
```

### 8. Create or push the tag

If the tag does not exist yet:

```bash
git tag "$tag_name_var"
git push origin "$tag_name_var"
```

If the tag already exists and points at the intended release commit, reuse it.

If the tag exists but points to the wrong commit, stop and ask the user before changing anything.

### 9. Create or update the GitHub Release

The GitHub UI only shows a real release entry after a release record exists. A tag by itself is not enough.

Build the release body from the matching `CHANGELOG.md` section. Use the version section as the source of truth.
Write the GitHub Release body in English.

If the release does not exist yet:

```bash
gh release create "$tag_name_var" \
  "packages/extension/antigravity-bridge-extension-${version_to_release_var}.vsix" \
  --title "$tag_name_var" \
  --notes-file /filepath_to/release/body.md
```

If the release already exists, update it instead of creating a duplicate:

```bash
gh release edit "$tag_name_var" \
  --title "$tag_name_var" \
  --notes-file /filepath_to/release/body.md
```

The release notes should explicitly include:

- The user-visible changes
- The release metadata line as the final bullet, if the app or model is known

```markdown
- via APP_NAME_VAR, MODEL_NAME_VAR
```

### 10. Sync the locally installed source

The local wrapper uses `$HOME/.antigravity-cli/source`, not the working repository directly.

After pushing `main`, fast-forward the installed source:

```bash
git -C "$HOME/.antigravity-cli/source" fetch origin main
git -C "$HOME/.antigravity-cli/source" pull --ff-only origin main
```

Then confirm:

```bash
antigravity-cli -v
git -C "$HOME/.antigravity-cli/source" status --short
```

### 11. Final verification

Confirm all of these before closing the task:

- `git status --short` is clean in the working repository
- `git -C "$HOME/.antigravity-cli/source" status --short` is clean
- `antigravity-cli -v` prints the new version
- `gh release view "$tag_name_var"` succeeds
- The release page contains notes
- The release page notes are in English
- The release page has the `.vsix` asset
- `CHANGELOG.md` links point at the correct release tag

## Failure rules

- If full CLI tests fail, state that clearly with the exact failing tests.
- If packaging the `.vsix` fails, do not pretend the release asset exists.
- If GitHub Release creation fails, do not say the release is published.
- If the local installed source is behind, do not claim the local CLI version is updated.
- If the tag already exists on the wrong commit, stop and ask before rewriting it.

## Output format for the user

When you finish a release, report these items explicitly:

- Released version
- Commits created
- Whether `main` was pushed
- Whether the tag was pushed
- GitHub Release URL
- Whether the `.vsix` asset was uploaded
- Which tests were run
- Any known failures or skipped checks
- Whether the installed local CLI was synced
- Whether the release metadata line was included, and if not, why it was omitted

## Example trigger prompts

These are the kinds of requests that should trigger this skill:

- `0.1.2 릴리즈 해줘`
- `버전 올리고 태그랑 GitHub Release까지 다 해줘`
- `CHANGELOG 갱신하고 release page도 채워줘`
- `v0.1.3으로 올리고 .vsix까지 다시 설치해줘`
- `태그는 만들었는데 Releases에 아무것도 안 떠, 마저 처리해줘`
