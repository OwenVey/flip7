# 003 — Replace continuous table motion

- **Status** — TODO
- **Commit** — `e031a95`
- **Severity** — MEDIUM
- **Category** — Purpose, frequency, and performance
- **Estimated scope** — One stylesheet

## Problem

`src/app.css:1657` scrolls the background on every at-risk meter. `src/app.css:3334` animates the shadow of every enabled target seat. Both run continuously during states that players may spend time reading.

```css
&[data-round="at-risk"] .meter-round {
  animation: meter-risk 900ms linear infinite;
}

.seat[data-pickable]:has(.seat-pick:not(:disabled)) {
  animation: pick-pulse 1600ms ease-in-out infinite;
}
```

## Target

- At-risk meters use their current stationary diagonal stripes. Banked meters use the current solid fill.
- Enabled target seats use a steady 2 px inset ring in `var(--pick-color)`. Paint it as an inset shadow alongside the existing `var(--shadow-print)` and `var(--shadow-table)` so eligibility never changes seat dimensions. Disabled seats have no eligibility ring. The enabled 3 px offset focus outline remains distinct and works in reduced motion.

## Repo conventions to follow

Keep visual state in `src/app.css`. Reuse the target color variables at `:1936` and the inset ring approach already used for a turn seat at `:1774`.

## Steps

1. Remove the `meter-risk` declaration and keyframes. Keep the static stripe background and the banked and busted treatments.
2. Remove the `pick-pulse` declaration, its hover/focus cancellation, and the keyframes. After the selector changes in 002, add the static inset ring to `.seat[data-pickable]:has(.seat-pick:not(:disabled))` in normal CSS so touch and reduced-motion users see eligibility too.
3. Preserve the inset ring in the hover and focus shadow declaration. Omit the shadow from the pickable seat's transition properties so the eligibility ring appears immediately. Keep keyboard focus distinguishable from the ring and let the existing host Remove control sit above the target button.

## Boundaries

Keep the card-specific colors, dimming behavior, room eligibility, and disabled semantics. This plan covers the two indefinite effects. Score geometry changes are scoped to 005.

## Verification

- Run `pnpm check` and `pnpm test --run src/components/table.test.tsx`. The stylesheet and choice tests should pass.
- Compare five seconds of idle play and five seconds in an open action-card choice on a real phone. Inspect paint activity on the seats and meters. Neither selector should produce a running animation.
- Check Freeze, Flip Three, and Second Chance with pointer, touch, and keyboard. Eligible seats should be identifiable as soon as the choice is usable, and the keyboard outline should clearly show which one has focus.
