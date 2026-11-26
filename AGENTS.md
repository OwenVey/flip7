# Flip 7 agent instructions

Use the [README](README.md) for setup, game rules, and deployment. Before exploring the game domain, follow [Domain docs](docs/agents/domain.md) and use the terms in [GLOSSARY.md](GLOSSARY.md).

## Code map

| When working on | Start here |
| --- | --- |
| Deck, scoring, round progression, and action cards | `src/game/cards.ts`, `src/game/engine.ts`, `src/game/action-card-resolution.ts` |
| Move permissions and whose move is next | `src/game/moves.ts` |
| Room identity, seats, presence, eviction, and clocks | `src/game/room.ts`, `src/game/timers.ts` |
| WebSocket messages and command validation | `src/game/protocol.ts`, `src/game/client-message.ts` |
| Cloudflare routing, WebSocket transport, and persistence | `worker/index.ts`, `worker/room.ts`, `cloudflare.config.ts` |
| Room creation and existence checks | `src/lib/room-functions.ts` |
| Browser identity, reconnects, and pending moves | `src/lib/room-connection.ts`, `src/lib/room-client.ts` |
| Lobby, table, and deal playback | `src/routes/room/[code].tsx`, `src/components/table.tsx`, `src/lib/deal-playback.ts`, `src/lib/deal-plan.ts` |
| What the action bar says and offers (Table prompt) | `src/lib/table-prompt.ts`, `src/components/action-bar.tsx` |
| Styles | `src/styles/index.css` imports the area files in cascade order. `src/styles/tokens.css` defines the shared tokens; a variable one area reads stays in that file. `src/app.css` holds only `@layer ui-sdk;` |

## Room and game changes

- Before changing or reviewing game behavior, including move eligibility, eviction, reconnects, or deal playback, read [Flip 7 rules](docs/flip-7-rules.md) and check the affected rules and fixtures. For behavior changes, run `pnpm test --run src/game/rules-acceptance.test.ts` and the relevant engine, room, or UI tests. Update the spec and regression coverage when a rule intentionally changes.
- Keep the Worker authoritative. Put move eligibility in `src/game/moves.ts` so the engine and UI use the same rules. Keep Cloudflare storage, alarms, and sockets in the Worker adapter so room behavior can be exercised in Vitest.
- **Pre-launch: one current format.** The site hasn't launched, so no stored rooms, browser data or clients exist in an older shape. Change persisted room state (`GameState`, `StoredRoom`), browser storage and the wire protocol in place: make new fields required, set them in the constructors (`createGame`, `newStoredRoom`, `addPlayer`, `addBot`), and update every reader and fixture to the new shape. Leave out "saved before" fallbacks, `??` defaults for old data, migrations and tests of old shapes. Keep validating everything from the network or browser storage, so corrupt data is rejected or reset. Revisit this rule at launch.
- Preserve rejoining by token, pending-move confirmation after reconnecting, and presence across multiple seats. Use `toRoomView` to project what the browser can see.
- When changing a rule, check the in-game rules in `src/components/rules-dialog.tsx` and the README for descriptions that need updating.
- Keep only the style imports in `src/styles/index.css`. Rule order across the files in `src/styles/` is the cascade order, so add a rule to the file and position where it belongs.
- Fonts come from the `@fontsource` packages through Fontless, configured in `fonts.config.ts`. Name a family only in the `--font-*` stacks in `src/styles/tokens.css`. Fontless adds its `@font-face` rules and metric fallbacks there, so don't write fallback families by hand. When a family is set in a new weight, add it to that family's `fallbackInstances`; if `--font-numeral` ever renders a new character, add it to `Big Shoulders Display Variable`'s `glyphs` list. `src/styles/stylesheets.test.ts` checks both entry files and the fallback weights.
- Use the `@custom-media` breakpoints in `src/styles/tokens.css` in every `@media`: `--sm` (40rem) and `--lg` (64rem) from Tailwind's scale, and `--short` (30rem tall). Combine them, as in `not (--sm)` or `(--lg) and (not (--short))`, and don't add a size. Lightning CSS resolves them, which `vite.config.ts` sets up. `SHEET_TABLE_QUERY` in `src/components/table.tsx` repeats `--sheet-table` for `matchMedia`. `src/styles/breakpoints.test.ts` checks all of this. For a component's own width, use a `@container` query.
- Take values from the tokens in `src/styles/tokens.css`, which is the only file with hex colors, `@custom-media` or `:root` variables: colors, `--text-*` for interface text, `--tracking-*`, `--leading-*`, and `--duration-*` for transitions. Use font weights 400, 600, 700 and 800 for Inter and 600 and 900 for numerals. Spacing follows Tailwind's steps: 0.125rem up to 1rem, then 0.25rem. Give a choreographed animation's timing a named local property. `src/styles/design-scale.test.ts` checks these.
- Keep the app and Worker TypeScript configurations separate. The Worker types are generated under `.cloudflare/types` by `pnpm typecheck`.

## Solid 2.0

Read the Solid 2.0 skill before writing or reviewing Solid code. Check unfamiliar APIs against `node_modules/solid-js/CHEATSHEET.md`.

- Read reactive props through `props` and pass values to components. Read signals in JSX or tracked computations, or use `untrack` for a deliberate one-time read.
- Use `createEffect(compute, apply)`, `onSettled` for setup and cleanup, and draft setters for stores. Write from event handlers, effect apply callbacks, `onSettled`, or actions.
- Use `solid-js` for reactive primitives and `@solidjs/web` for DOM APIs. In tests, use `flush()` before asserting on batched updates when needed.
- For a Solid diagnostic code, use the reactivity-diagnostics skill or the installed diagnostic reference named in the console footer. Use the agent-loops skill when you need to verify reactive behavior with a diagnostics capture.
- When a test asserts `expectNoDiagnostics`, capture with `captureScenario` from `src/test/diagnostics.ts`. It turns off HOT_SCOPE_TIME and WASTED_RECOMPUTE, which measure wall-clock time and fail on a busy machine.

## ui-sdk

Before using ui-sdk, follow the [ui-sdk skill](.agents/skills/ui-sdk/SKILL.md) and read `node_modules/@ui-sdk/solid/docs/llms.txt`. For new components, also look up the relevant heading in `core.md` and read `rendering.md` in the same directory.

Button-like parts share the base `:is(...)` rule in `src/styles/controls.css`. Add the `data-slot` for any new trigger or close part to that rule. Use `data-variant` (`solid`, `destructive`), `data-tone="danger"` for a red paper button, and `data-size="sm"` for variations. Leave `data-variant` off for the default paper button. Keep sizing, padding, borders, and font in the shared rule.

## Verification

- Follow the [Ultracite code standards](.agents/skills/ultracite/references/code-standards.md), using the Solid conventions above for framework code. Use `pnpm check` to verify and `pnpm exec ultracite fix <paths>` for targeted fixes.
- Put regression coverage at the layer that owns the behavior. Game, room, and timer tests sit next to their source under `src/game/`. Browser room-client and playback tests are under `src/lib/`. Route and component tests use jsdom and Solid Testing Library.
- For a focused run, use `pnpm test --run <path>`. Run `pnpm typecheck` for TypeScript changes and `pnpm build` for changes that affect Worker setup, SSR, routing, or bundling.

## Project workflow

- **Issues and specs** follow the [GitHub issue tracker workflow](docs/agents/issue-tracker.md).
- **Triage** uses the [project label mapping](docs/agents/triage-labels.md).
