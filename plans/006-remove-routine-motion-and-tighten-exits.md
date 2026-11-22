# 006 — Remove routine motion and tighten overlay exits

- **Status** — TODO
- **Commit** — `e031a95`
- **Severity** — LOW
- **Category** — Purpose, frequency, and exit timing
- **Estimated scope** — Three source files

## Problem

The effect at `src/components/table.tsx:826` pops the deck count after every change. The selectors at `src/app.css:3373` animate both new and historical rows on mount. Dialogs, tooltips, and anchored overlays use `ease-in` on exit at `src/app.css:540`, `:660`, and `:709`.

```ts
if (previous !== undefined && count !== previous) {
  pop(counter);
}
```

```css
.log-group li {
  animation: log-in 260ms ease-out both;
  transition: background-color 400ms ease;

  &[data-kind="chat"]:not([data-own]) {
    animation: pop-in 300ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
  }
}
```

## Target

- Deck counts and mounted log entries update immediately. Keep the visible deck stack states, unread markers, and entry styling.
- Use `var(--ease-out)`, defined as `cubic-bezier(0.23, 1, 0.32, 1)`, for non-sheet overlay exit timing. Set exits to 140 ms for dialogs, 150 ms for tooltips, and 110 ms for anchored overlays. Preserve the existing 120 ms linear reduced-motion fades and immediate behavior for grouped instant tooltips.

## Repo conventions to follow

Reuse the ease-out token defined in 005 and the existing `[data-ending-style]` transition selectors. Use the shared tooltip `[data-instant]` rule at `src/app.css:666` and the deck's existing direct text binding at `src/components/table.tsx:854`.

## Steps

1. Remove the deck counter effect and its element ref from `table.tsx`. Keep the text and screen-reader suffix. After 005, delete the unused `pop` helper, its import, and `POP_MS` after verifying callers.
2. Delete the log-row entrance block and unused `log-in` keyframes from `app.css`. Preserve static chat and game-event styling and the shared `pop-in` keyframes used by seat metadata.
3. In the common dialog, tooltip, and anchored-overlay rules, replace the exit timing function with `var(--ease-out)` at the durations above. Preserve the positional origin, opacity endpoint, `[data-instant]` specificity, and reduced-motion overrides from 002. Keep the dialog backdrop and swipe-driven sheet paths.

## Boundaries

Keep existing input and focus behavior, lobby arrivals, button feedback, game-log filters, and chat pinning. Keep the reshuffle riffle and deal motions.

## Verification

- Run `pnpm test --run src/components/table.test.tsx src/components/game-over-dialog.test.tsx`, `pnpm typecheck`, and `pnpm check`. The suites and checks should pass.
- Deal several cards, then switch between All, Chat, and Game with a populated log. Deck text should update directly and existing entries should appear instantly when filters change.
- Open and dismiss a tooltip, sound popover, and confirmation dialog. Repeat quickly to check the existing transitions reverse cleanly and focus returns. Repeat with reduced motion. On a phone, confirm the chat sheet still tracks a swipe and reverses when released short of dismissal.
