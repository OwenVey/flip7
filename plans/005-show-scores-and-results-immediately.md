# 005 — Show scores and results immediately

- **Status** — TODO
- **Commit** — `e031a95`
- **Severity** — MEDIUM
- **Category** — Readability, timing, and performance
- **Estimated scope** — Four source files and two component test files

## Problem

`src/app.css:1559` and `:1644` animate score geometry for 600 ms while `src/lib/count-up.ts:25` updates digits on animation frames. Scored leaderboard values start fading in after a row-dependent delay at `src/app.css:3344`. The game-over dialog opens after 700 ms in `src/components/game-over-dialog.tsx:25`, then its focusable actions wait another 650 ms to start appearing. At game over there are also 56 table confetti pieces, 28 trophy particles, a repeating winner shine, and indefinitely rotating rays.

```css
--meter-ease: 600ms cubic-bezier(0.22, 1, 0.36, 1);

.leaderboard-round[data-scored] {
  animation: rise-in 320ms ease-out calc(var(--row, 0) * 60ms + 150ms) both;
}

.game-over-actions {
  animation: rise-in 320ms ease-out 650ms both;
}
```

## Target

- Meter geometry and score text update directly from the same score values. Visible round points still update after the incoming card lands.
- Use one score-bank animation. The projected score scales from 1 to 1.10 at 35% and back to 1 over 180 ms using `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. Keep banked and at-risk visual states available with reduced motion.
- Scored standings, winner text, and dialog actions have zero per-element entrance delay. Retain the existing 700 ms before opening the dialog so the last table outcome can register. The dialog uses the shared centered-dialog entrance and the existing reduced-motion fade.
- Keep the trophy as the game-over animation. Use a single 280 ms stamp with the ease-out token, zero delay, and an initial state of `opacity: 0; rotate: -8deg; scale: 1.2`. Keep the rays static and keep gold winner highlighting. Remove both particle effects and the repeated shimmer.

## Repo conventions to follow

Define the ease-out token with the custom properties at the top of `src/app.css`. Reuse the existing state attributes on score and winner elements and the keyed row identity at `src/components/table.tsx:740`.

## Steps

1. In `table.tsx`, render `baseScore()`, `roundPoints()`, the existing leaderboard round points memo, and `entry().player.score` directly. Remove the count-up wrapper, round-count timing constant, score-pop effect and ref, and the leaderboard's animation-only `data-scored`, `--row`, and related index prop. Keep the accessible score labels, rank slide, tabular digits, and incoming-card gating. Keep the deck's `pop` import until 006.
2. In `game-over-dialog.tsx`, render the final score directly and keep its pluralized screen-reader label. Remove the FinalScore `roundPoints` prop, row delay styles, burst markup, and burst style helpers. Retain the title, rankings, controls, native dialog focus, and 700 ms timer.
3. Remove the table's `Confetti` component, its mount, and animation-specific helpers and imports that are now unused. Remove the corresponding CSS and reduced-motion display rule. Delete `count-up.ts` after checking that it has no other callers.
4. In `app.css`, remove meter width and inset transitions and their timing token. Remove the locked meter filter animation and shorten the existing `score-bank` animation to the target. Remove the scored-cell entrance, game-over title, row and action staggers, shimmer, and the oversized game-over dialog transition override. Keep the base gold winner styles. Keep the base trophy and ray styling and apply the new trophy stamp only when motion is allowed. Remove keyframes that lose their last caller.
5. Update the existing test that counts up on reveal and down on bust to assert immediate visible scores at those state changes and preserve the test that points wait for the incoming card to land. Replace the final score count-up test with an assertion that final scores are visible when the dialog opens. Retain winner, focus, and return-to-lobby coverage.

## Boundaries

Keep scoring, rank ordering, move eligibility, standings placement, and round timing. Keep the existing loss feedback and Flip 7 celebration on the table. Scope the game-over simplification to the redundant animations and their markup.

## Verification

- Run `pnpm test --run src/components/table.test.tsx src/components/game-over-dialog.test.tsx`, `pnpm typecheck`, and `pnpm check`. The suites and checks should pass.
- Finish a 16-player round with the leaderboard visible. Inspect the recording for immediately readable values, retained rank motion, and reduced per-frame layout and script work as scores bank.
- Finish a game on a narrow phone. The trophy should animate once and the title, visible scores, and controls should appear with the dialog entrance. Tab to both controls during opening and scroll to the last standing. Repeat in reduced motion to verify stationary results and visible winner styling.
