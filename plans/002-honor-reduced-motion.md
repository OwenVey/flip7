# 002 — Honor reduced motion during play

- **Status** — Implemented. Phone verification pending.
- **Commit** — `e031a95`
- **Severity** — HIGH
- **Category** — Accessibility and interruption
- **Estimated scope** — CSS, Room route, playback, and playback tests

## Problem

In `src/app.css:1960`, the target rule has an extra `:not(:disabled)` and wins over the reduced-motion reset at `:1987`. Direction-specific tooltip and popup declarations at `:644` and `:714` also win over their reduced-motion translation resets. `src/lib/deal-playback.ts:213` checks motion on snapshot entry and keeps running if the preference changes later.

```css
&:has(.seat-pick:is(:hover, :focus-visible):not(:disabled)) {
  z-index: 1;
  transform: translateY(-6px);
  outline: 3px solid var(--pick-color);
  outline-offset: 3px;
```

```ts
const animate = motion.allowed();
const steps = animate ? planDeal(previous, current) : [];
```

## Target

- Target focus shows the existing 3 px card-colored outline with 3 px offset. Seat movement is limited to an enabled mouse-style hover inside `@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)`. Hover lift remains 6 px with a 140 ms transform transition. Under reduced motion, target changes may fade opacity over 120 ms linear and use immediate outline and shadow feedback.
- Reduced-motion tooltips and anchored popups have no displacement or scale change at either endpoint and may fade over 120 ms linear. An instant tooltip still updates immediately.
- If the preference changes to reduce or the document becomes hidden mid-playback, cancel the active flight or wait, clear queued intermediate frames, and show the most recent authoritative room with its actual move eligibility. A local move that is newly usable receives the existing cue once. Resuming motion affects future updates.

## Repo conventions to follow

Use ui-sdk state attributes and leave positioning to the existing anchored layer. Follow the reduced-motion dialog fade in `src/app.css:545` and the owner cleanup in `src/routes/room/[code].tsx:127`. Playback owns its queue and abort controller as in `src/lib/deal-playback.ts:247`.

## Steps

1. In `src/app.css`, move the tooltip and popup directional translate rules under `prefers-reduced-motion: no-preference`. Keep their existing distances and transform origins. Use opacity-only transition declarations for reduced motion. Give the tooltip's `[data-instant]` rule precedence over the reduced-motion fade.
2. Separate enabled target focus styling from hover styling. Keep focus stationary, apply hover styling only under the fine-pointer query, and put the moving hover declaration and its transform transition under the full query above. Gate the hover-driven sibling dimming on a fine pointer. Keep keyboard-driven dimming, and remove the losing reduced-motion transform override at `:1987`.
3. Add a playback method that catches up if motion is disallowed and a run is active. Abort the owning controller, discard its queued frames, set `settled` to the latest known room, and publish that room with `step: null`, `incomingCardId: null`, and `dealing: false`. Release `run` before publishing so the normal eligibility and one-shot local cue logic runs. The old drain must check its aborted signal before publishing, clearing a newer run, or emitting a cue. Do not replay skipped deal or reveal sounds. Preserve the normal snapshot path for updates that arrive while motion is disallowed.
4. In the Room route's existing `onSettled`, subscribe to `(prefers-reduced-motion: no-preference)` changes and `visibilitychange`. Use the playback method from step 3. Remove both listeners in the existing cleanup before disposing playback. Keep the optional `matchMedia` handling used by `motionAllowed`.
5. Extend the fake-timer playback coverage for mid-flight interruption. Queue a newer room, switch motion off, and assert latest-room publication, a cleared incoming card, and a single cue with controls ready. Run the outstanding timers and assert no stale publication or cue. Keep existing leave and room-change coverage.

## Boundaries

Keep action-card eligibility, focus order, and swipe-owned sheet behavior. Scope live interruption to deal playback. Apply 003 after this plan so its target marker shares the new enabled-state selectors.

## Verification

- Run `pnpm test --run src/lib/deal-playback.test.ts src/components/table.test.tsx`, `pnpm typecheck`, and `pnpm check`. The suites and checks should pass.
- Emulate reduced motion and inspect tooltip and sound settings popover opening and closing at slow playback. Their visible anchor position should stay fixed. Tab through action-card choices. The outline should follow focus with no lift.
- On a touch device, choose a target and confirm no sticky hover styling. Toggle reduced motion during a flight and repeat by hiding the tab. On return, check that the newest hand, choice, and usable controls agree.
