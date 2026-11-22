# Slip7 animation implementation plans

These plans cover all six findings from the motion audit at `e031a95`. Source line references refer to that commit. Radius and offline-move copy edits in the working tree can shift those lines. Match edits by selector or function and preserve those changes. Capture the device baseline before changing any motion so the same scenarios can be compared afterward.

| Order | Plan | Severity | Status | Dependencies |
| --- | --- | --- | --- | --- |
| 1 | [Shorten deal playback](001-shorten-deal-playback.md) | High | Implemented. Phone verification pending. | Baseline recording for device comparison |
| 2 | [Honor reduced motion during play](002-honor-reduced-motion.md) | High | Implemented. Phone verification pending. | 001 |
| 3 | [Replace continuous table motion](003-replace-continuous-table-motion.md) | Medium | TODO | Extend the target selectors from 002 |
| 4 | [Simplify turn and bust cues](004-simplify-turn-and-bust-cues.md) | Medium | TODO | Apply after 002 to keep the Room route edits small |
| 5 | [Show readable scores and results immediately](005-show-scores-and-results-immediately.md) | Medium | TODO | Compare the score changes against the baseline |
| 6 | [Remove routine motion and tighten overlay exits](006-remove-routine-motion-and-tighten-exits.md) | Low | TODO | Reuse the timing token from 005 and clean up the last score/deck pop caller |

## Device recordings

Record on a real mid-range phone, with the same browser, viewport, and room setup before and after. Keep timings calculated from code distinct from observed results.

1. Record a 16-player opening deal and redeal with populated hands. Measure time from receipt of the room update that makes a move available to the first enabled control for that move. Inspect layout and style work at flight startup, paint during flight, and frame pacing during the sweep.
2. Record Flip Three into an action-card choice or a Second Chance discard. Repeat after backgrounding and returning to the tab, and after enabling reduced motion mid-flight. Check card placement, move readiness, and the local turn cue.
3. Record five seconds with a full table at rest and five seconds while choosing an action-card target. Compare paint activity. Finish a round with the leaderboard visible and finish a game with the dialog open. Look for simultaneous score updates, layout, paint, and dropped frames.

The existing invite-copy checkmark and label give immediate feedback. An opacity cue there was an optional idea from the audit and is outside these six plans.
