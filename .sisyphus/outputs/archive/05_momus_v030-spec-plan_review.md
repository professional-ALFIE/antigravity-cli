## Critical Issues
1. \u00A75-9 wake-up policy says "prompt \uC2DC\uC791 \uD6C4: background\uB85C current account cloud quota \uC870\uD68C \u2192 \uACC4\uC815 \uCE74\uB4DC \uAE30\uB85D \u2192 rotate \uD310\uB2E8 \u2192 rotate \uC801\uC6A9", but \u00A7\u00A73-3, 5-1, 6-1, and checklist item 6 say rotate happens only after the response ends. Fix the document so rotate timing is single-source-of-truth: pre-response background wake-up or quick check may run, but quota crossing and switch apply must remain post-prompt.
2. \u00A79-3 checklist items only have verification links, not executable QA scenarios. Add a QA block to every task with tool, concrete steps, and expected result so the Final Verification Wave can actually be executed.

## Minor Issues
- Checklist item 10 should pin the primary code files for the Offline-Gateway minimum path more concretely, because "src/main.ts + offline/live \uAD00\uB828 \uC11C\uBE44\uC2A4" is the loosest module reference in the plan.

## Approved Decisions
- The split between auth refresh and auth list, and redefining pending-switch.json as an applied record, preserve the main handoff context well.
- Fingerprint-at-login plus serviceMachineId-at-switch, and the explicit local fast-path source priority, correctly reflect the requested v0.3.0 scope.
- The success conditions are broadly complete on product intent, and the NOT NOW scope is not overly broad except for the QA gap above.

