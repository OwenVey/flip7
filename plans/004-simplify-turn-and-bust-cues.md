# 004 — Simplify turn and bust cues

- **Status** — TODO
- **Commit** — `e031a95`
- **Severity** — MEDIUM
- **Category** — Purpose, frequency, and timing
- **Estimated scope** — Three source files

## Problem

`src/app.css:3224` animates the bust stamp, duplicate, and seat together. `src/app.css:3237` adds a transient outline to the persistent turn ring. `src/routes/room/[code].tsx:60` nudges the action bar before scrolling to the local seat.

```css
.seat[data-status="busted"] {
  animation: seat-flinch 420ms ease-out;
}

.seat[data-turn] {
  animation: turn-ring 600ms cubic-bezier(0.25, 0.8, 0.3, 1);
}
```

```ts
nudge(roomPage?.querySelector("[data-action-bar]") ?? null);
revealSeat(roomPage?.querySelector(".seat[data-me]") ?? null);
```

## Target

The transient turn outline, action-bar nudge, and whole-seat bust flinch use zero animation. The persistent seat ring, action-bar turn treatment, and nearest-edge seat scroll continue to identify the next move. The bust stamp, duplicate cue, and meter loss remain intact.

## Repo conventions to follow

Use the existing `[data-turn]` styling at `src/app.css:1310` and `:1774`. Keep the existing `revealSeat` helper at `src/lib/table-motion.ts:55`, including its reduced-motion behavior.

## Steps

1. In the Room route's turn cue, remove the `nudge` call and import. Keep `revealSeat`, sound, and vibration.
2. Delete the unused `nudge` export and `NUDGE_MS` constant from `table-motion.ts`.
3. Remove the `seat-flinch` and `turn-ring` animation declarations and keyframes in `app.css`. Update the adjacent comments to describe the remaining bust effects. Keep the permanent `[data-turn]` seat and action-bar styles.

## Boundaries

Keep the turn cue trigger and automated moves intact. Leave the Freeze and Flip 7 animations, action-card landing bump, dealer chip, and score-bank styling in their existing paths.

## Verification

- Run `pnpm test --run src/lib/deal-playback.test.ts src/components/table.test.tsx`, `pnpm typecheck`, and `pnpm check`. The suites and checks should pass.
- On a phone, wait for a local move with the local seat above and below the viewport. Confirm scrolling brings the seat into view and an already visible seat stays put. Repeat with reduced motion and confirm the scroll is immediate.
- Bust on a duplicate Number card. The duplicate and outcome should be clear while the surrounding seat stays stationary. Trigger Freeze and Flip 7 and confirm their existing cues still play.
