# Draft: v021-auth-spec

## Confirmed
- New integrated spec is required.
- `spec-gpt` has broader requested scope but is too rough.
- `spec-opus` has stronger execution detail but omitted requested items.
- Wake-up and seamless-switch semantics are central, not side notes.
- Public auth command surface should stay minimal for now: `auth login`, `auth list`.
- This session is **spec-only** until explicit approval to go beyond it.
- The immediate deliverable is the spec document and its success criteria, not an implementation plan.
- Version target is v0.2.1, not v0.3.0.

## Confirmed Decisions
- Keep `pending-switch.json` persistence.
- Prefer detailed sticky-threshold auto-rotate.
- Prefer detailed wake-up modeling.
- Keep public auth surface minimal for now (`auth login`, `auth list`).
- Treat browser OAuth as the fundamental new-account path.
- Keep `import-local` alive as an internal/product axis even if not exposed first as a public command.
- Place `import-local` in the integrated spec as an internal capability.
- Place `import-token` in the integrated spec as an internal / migration capability.
- Describe `auth inject` as both a core apply mechanism and a switch sub-action.
- Write wake-up as both a feature and a validation axis.
- Write success criteria in claim-by-claim proof style.
- Treat upcoming other-session results as primary evidence.
- Google OAuth direction: Cockpit-compatible credential approach.
- `account_status`: Opus-style 4-state enum.
- Browser OAuth is the main registration path.
- Local Import is still required internally because existing `user-data` accounts must be migrated/extracted.
- No separate `quota` command in this version; `auth list` is the intended quota surface.
- Overlay/shared conversation model is the default direction.
- `Plugin Sync`, `Device Fingerprint`, `Default backup(user-00)` are NOT NOW.
- `auth import-local` should be an internal function only.
- Keep quota source as a decision gate for now.
- Quota success criteria should be written by source-path proof.
- First paragraph of the integrated spec should foreground the auth-only refactor.
- User requested very simple language from now on; avoid unexplained jargon.
- Latest feedback: even the simplified summary was still too hard; use shorter and more everyday Korean.
- Session wording should be simple: same conversation records keep going after account change, but the server may sometimes block continuation.
- `auth inject` wording should lean inject-first, not Cockpit-style full-switch wording.

## Open Questions
- How should auth inject / full switch / seamless switch be redefined for this CLI?
- Is wake-up able to produce reliable UI/state.vscdb updates that justify keeping LS/state-based quota sources?
- How should import-local/import-token be placed in the final spec if public commands stay minimal?
- What exact success conditions should gate each spec claim so that the spec can be considered complete?
- User said they will provide other-session question results before some of these are finalized.
- Quota source wording remains partially open because the user selected multiple competing options and asked for further comparison.
- The next decisive input should be the promised other-session evidence.
- Still open after the other-session evidence:
  - final plain-language wording for session sharing and what happens when the server refuses to continue a conversation after account change
  - exact wording for auth inject vs seamless switch vs runtime apply

## Simple Words To Prefer
- shared conversation = 같은 대화 계속 쓰기
- server blocks continuation = 서버가 이어쓰기 막음
- auth inject = 로그인 정보만 갈아끼우기
- quota source = 사용량을 어디서 읽는지

## Recent Investigation Note
- Oracle retry for switch semantics failed again due quota limits.
- Continue using: repo evidence + Cockpit reference + direct user clarification.

## Important User Thesis
- Cockpit's switch vocabulary may not map directly.
- Since this project is refactoring toward auth-only storage instead of full profile switching, auth apply may need to be described as a seamless/auth-only path by default, with live runtime reaction treated as the uncertain part.
