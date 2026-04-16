# Mandate: v021-auth-spec

## Current Goal
- Create a new integrated v0.2.1 auth spec by reconciling:
  - `handoff-plan-spec/v0.2.1-02-spec-gpt.md`
  - `handoff-plan-spec/v0.2.1-02-spec-opus.md`
  - `handoff-plan-spec/cockpit조사-01-auth.md`
  - `handoff-plan-spec/cockpit조사-03-quota.md`
- **Scope lock (latest user instruction):**
  - Do **not** create implementation plans, implementation TODO waves, or execution plans in this session.
  - Until explicit user approval, this session produces only:
    - integrated spec decisions
    - success criteria / acceptance criteria for the spec
  - In other words, the planning target is **a plan for writing the spec document**, not a plan for implementing the product.

## User-Confirmed Priorities
- Base document style: create a **new integrated spec**, not minor edits on one old spec.
- Most important missing/incorrect areas:
  - seamless switch semantics
  - wake-up semantics and validation path
  - registration paths must not be dropped
- Public command surface for now should remain minimal:
  - `auth login`
  - `auth list`
- `auth import-local` may exist as internal capability / implementation axis, because extraction is still needed.
- New account addition should fundamentally use browser OAuth.
- Command surface preference is **auth-centered/minimal**, not broad command expansion.
- User explicitly said wake-up is extremely important and spec must treat it as central.
- User explicitly said the previous seamless/full-switch framing is likely conceptually wrong for this project and needs redefinition.
- `import-local` should be placed in the final spec as **internal capability**, not necessarily as a first public command.
- `import-token` should be placed as an **internal / migration axis**, not necessarily as a first public command.
- `auth inject` should be described in a dual way:
  - as the **basic apply mechanism**
  - and also as a **sub-action inside switch/account-change flows**
- Wake-up should be written as **both**:
  - a product feature
  - a validation axis that helps determine quota source strategy
- Success criteria should use a **claim-by-claim proof style**, not only coarse feature acceptance.
- Other-session findings, once shared, should be treated as **primary evidence** that can change the integrated spec.
- Version target correction from the user: this work is **v0.2.1**, not v0.3.0.
- Google OAuth direction from other-session evidence: use the Cockpit/official-app-compatible credential approach.
- `account_status` should use the Opus-style 4-state enum.
- Browser OAuth is the default/primary registration path.
- `import-local` remains necessary because existing `user-data` accounts must be extractable without re-login.
- No separate `quota` command in this version; `auth list` should carry the quota surface.
- Shared/overlay conversation continuity is a core intended value.
- `Plugin Sync`, `Device Fingerprint`, and `Default backup(user-00)` are all NOT NOW for this version.
- `auth import-local` should be an internal function only, not a public command.
- User explicitly requested: from now on, avoid undefined jargon and use simpler Korean explanations first.
- Session-sharing policy wording direction:
  - same conversation records should continue to be used even after account change
  - but the spec must openly mention that the server may sometimes block continuation after account change
- `auth inject` wording direction:
  - inject-centered redefinition is preferred
  - simple-language comparison is still needed before final wording is frozen

## Product Questions Already Answered
- `pending-switch.json` persistence: YES.
- Auto-rotate precision: use the detailed Opus sticky-threshold model.
- Wake-up detail level: use the detailed Opus wake-up model.
- Registration paths: do not drop the 3-path axis; public exposure timing can differ from internal capability placement.
- Spec base: new integrated spec, not “gpt plus patch” or “opus plus patch”.
- Wake-up is extremely important and should influence spec decisions.
- Public surface remains minimal for now even if internal capability axes are retained.
- `import-local` = internal capability.
- `import-token` = migration/internal axis.
- `auth inject` = both primary apply mechanism and switch sub-action.
- Wake-up = feature + validation axis.
- Success criteria = claim-by-claim proofs.
- Version = v0.2.1.
- Google OAuth = Cockpit-compatible credential approach.
- `account_status` = 4-state enum.
- Browser OAuth = primary registration path.
- No standalone `quota` command in this version.
- Overlay/shared conversation model = default spec direction.
- `Plugin Sync`, `Device Fingerprint`, `Default backup(user-00)` = NOT NOW.
- `auth import-local` = internal function only.
- Quota source wording = keep as a decision gate.
- Quota success criteria = proof by source path.
- First paragraph tone = auth-only refactor first.
- `auth inject` wording leans toward inject-centered redefinition, but the exact wording still needs a simpler-language follow-up because the user also asked for comparison.
- Session continuity success criteria should prioritize: "the user can keep working even after account change".

## Critical Open Semantics
- The old "Full Switch default" wording is likely conceptually wrong for this project.
- User's claim:
  - In Cockpit, "full switch" is partly about needing the app/plugin environment.
  - In this project, the older method switched whole `user-data-dir` profiles.
  - The refactor goal is to store **auth only** separately.
  - Therefore auth injection should likely be conceptualized closer to a seamless/auth-only apply path.
  - Because this CLI often runs headless/background rather than as a visible IDE app, the user suspects the problem may actually be easier here.
- This requires targeted investigation before final wording is locked.
- Oracle was retried for this semantics question but failed again due quota limits, so current reasoning must proceed from repo evidence + Cockpit reference + user clarification.

## Quota Source Decision Rule Under Discussion
- If wake-up success causes UI surfacing and reliable `state.vscdb` updates, user is open to:
  - live LS when live exists
  - otherwise `state.vscdb`
- If not, user is open to Cloud Code REST direct quota.
- Therefore wake-up writeback behavior is a gating experiment for the spec.
- The spec should likely present this as a **decision gate / proof requirement**, not as a silently assumed implementation fact.
- However, the user also selected both:
  - Cloud Code fixed
  - LS/state priority
  - and requested further comparison
- So quota source wording is still **not fully locked** and should be revisited after other-session evidence is provided.

## Current Repo Facts Already Verified
- Current public auth commands are only `auth list` and `auth login`.
- `auth list` currently uses:
  - live LS `GetUserStatus` when live LS exists
  - otherwise persisted `state.vscdb` parsing per account
- `auth list` selection currently changes only active account name; it does **not** inject auth state.
- Offline surfaced writeback currently exists for trajectory/sidebar state, but not yet as proof that wake-up updates quota/userStatus in a way sufficient for the future quota design.
- Therefore, the user's statement that `auth list` already effectively covers the quota surface is consistent with the current code's product shape, even though the future quota source is still undecided.

## Plain-Language Rule For Future Questions
- Do not use terms like "overlay", "ownership rejection", or similar without first redefining them in simple Korean.
- Prefer simple product-language wording first, then optional technical wording in parentheses only if needed.
- Latest user feedback: even recent summaries were still too hard. Use shorter sentences and everyday words first.

## Plain-Language Definitions To Use
- shared conversation = 계정을 바꿔도 같은 대화 기록을 이어서 쓰는 방식
- server blocks continuation = 서버가 "이 대화는 지금 계정으로는 이어서 못 쓴다"고 막는 상황
- auth inject = 프로필 전체를 바꾸지 않고 로그인 정보만 갈아끼우는 방식
- quota source = 사용량 정보를 어디서 읽어올지 정하는 기준

## Spec Integration Guardrails
- Do not silently drop `import-local`, `import-token`, wake-up, or seamless-switch investigation just because one prior spec moved them to NOT NOW.
- Keep the public command surface minimal **unless** user explicitly broadens it.
- Distinguish clearly between:
  - auth storage model
  - auth apply/inject model
  - live-runtime reaction to injected auth
  - quota source
  - wake-up as a feature vs wake-up as a validation experiment
- Do not add implementation sequencing, engineering waves, or coding task breakdowns unless the user later explicitly asks for them.
