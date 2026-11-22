# 001 — Shorten deal playback

- **Status** — TODO
- **Commit** — `e031a95`
- **Severity** — HIGH
- **Category** — Purpose, timing, interruptibility, and performance
- **Estimated scope** — Three source files and the playback tests

## Problem

The timings in `src/lib/deal-playback.ts:11` serially budget 8.48 seconds for 16 ordinary cards. Move controls remain disabled while the run is active. The queue is checked once per step at line 155, so catching up takes effect at the next step. Discard and sweep have separate fixed durations in `src/lib/fly-card.ts:237` and `:281`. Every flight also animates its face shadow at `:203`.

```ts
const FLIGHT_MS = 460;
const FLIP_FLIGHT_MS = 560;
const HURRIED_FLIGHT_MS = 220;
const PAUSE_MS = 70;
const FLIP_PAUSE_MS = 260;
const FLIP_LEAD_IN_MS = 320;
```

## Target

| Beat | Duration |
| --- | --- |
| Single standard flight | 280 ms |
| Flip Three flight | 280 ms per reveal |
| Ordinary opening-deal flights when the snapshot has at least five deck-to-hand steps | 140 ms per card, with zero pause |
| Flight with queued room updates | 140 ms, with zero pause |
| Post-flight pause | 40 ms standard, 100 ms for Flip Three |
| Flip Three lead-in when needed | 150 ms |
| Discard | 240 ms standard, 160 ms while catching up, with `cubic-bezier(0.23, 1, 0.32, 1)` |
| Sweep | 240 ms plus at most 90 ms of stagger, with `cubic-bezier(0.77, 0, 0.175, 1)` and a per-card stagger clamped at 30 ms |

A 16-card deal budgets 2.24 seconds plus up to 330 ms for a sweep, before layout work and any landing correction. Keep the flight curve `cubic-bezier(0.25, 0.8, 0.3, 1)` and the mid-air flip's `ease-in-out`. The ghost face uses its resting shadow throughout the flight.

## Repo conventions to follow

Keep timing and sequencing in `src/lib/deal-playback.ts`, DOM bindings in `src/lib/deal-motion.ts`, and WAAPI in `src/lib/fly-card.ts`. Follow the abortable wait at `src/lib/deal-playback.ts:60` and the turn-cue ordering asserted at `src/lib/deal-playback.test.ts:105`.

## Steps

1. In `deal-playback.ts`, pass the existing `roundStarted` decision from `playTransition` into `playSteps`. Derive the shorter opening cadence from at least five deck-to-hand steps in a round-start snapshot. Apply it to ordinary deck-to-hand steps without `step.flip`. In the absence of queued updates, action-card and Flip Three steps retain their own cadence.
2. Recheck the queue after the flight and after landing. Use the fresh queue state when selecting discard duration and before waiting between cards. If a new snapshot arrives during a decorative lead-in or post-flight pause, end that pause through its own abortable wait. Keep the run signal separate so an interrupted pause still proceeds to the reveal or next step. An airborne card finishes its current flight.
3. Give `DealMotion.land` the discard duration as an argument. Pass it through `deal-motion.ts` to `discardCards`, preserving the existing partner lookup and simultaneous paired exit. Keep the lead-in suppression when the previous step already announced the Flip Three.
4. In `fly-card.ts`, apply the sweep timing from the target table. Keep the current stagger formula with the new spread and keep the existing abort and timeout paths. Remove the face's animated `boxShadow`, its lift constant, and the setup read used solely for that animation. Retain the ghost, flip, clone styling, and landing correction.
5. Update the existing fake-timer timing assertions. Add focused cases for the bulk deal budget and a queued snapshot interrupting a pause. Preserve the test that a superseded choice does not receive a personal turn cue.

## Boundaries

Keep the authoritative eligibility check, card order, held action card behavior, and playback cap. The next move becomes usable after the visual state has caught up. Keep the existing scope of the flight geometry and style-copy code unless a trace isolates it as a follow-up.

## Verification

- Run `pnpm test --run src/lib/deal-playback.test.ts src/lib/deal-plan.test.ts`, `pnpm typecheck`, and `pnpm check`. The suites and checks should pass.
- Compare the 16-player deal and redeal recordings. In stable geometry, aim for roughly 2.6 seconds or less from the relevant room update through a full ordinary sweep and deal. Record frame pacing separately. Inspect an ordinary Hit into a wrapping hand and confirm the landing aligns.
- Play a Flip Three that presents a choice and one that uses Second Chance. Cards should reveal in order, the duplicate and Second Chance should depart together, and the local cue should fire once when the move is usable.
