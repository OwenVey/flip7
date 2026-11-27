# Type reuse audit

## Scope and method

Scanned all 185 tracked TypeScript and TSX files, including app and Worker entry points, routes, UI, game rules, storage, dev fixtures, tests, and root tooling. A syntax-tree pass compared 252 multi-member object declarations and the object shapes in Valibot validators. A manual pass checked non-identical shapes, schema/type pairs, and callers before deciding what to share. Generated output, dependencies, vendored agent instructions, styles, and static assets were outside this type audit.

## Consolidated in this pass

| Area | Source of truth |
| --- | --- |
| WebSocket game commands | [Client message validators](../../src/game/client-message.ts) define the commands once. Both the full client-message validator and the `GameCommand` type reuse that group. |
| Joining from the lobby or as a Spectator | [Join form props](../../src/components/join-form.tsx) define the shared inputs. Spectator controls pick the fields they forward and require them. |
| Host actions on a player | The [player menu](../../src/components/player-menu.tsx) defines its permissions and callbacks. The round player uses that contract when it forwards them. |
| Deal playback and the Move alert | The [Move alert](../../src/lib/move-alert.ts) picks the three playback fields it reads. Its tests use that same narrow view. |
| Test adapters | The [room](../../src/game/room.test.ts) and [room client](../../src/lib/room-client.test.ts) test adapters reuse the production connection shape, with the map holding the ID. The [count-up test](../../src/lib/count-up.test.ts) reuses the production function's parameters. |

## Kept separate on purpose

- **Engine moves and WebSocket commands.** The engine can run a move without a connection or request ID. The wire contract adds request correlation and validation for untrusted input. The command-schema cleanup does not make the engine depend on that contract.
- **Join preview, live room view, and stored game.** These expose different information and serve different callers. In particular, a join preview must not acquire fields just because they were added to the live view or storage.
- **Player identity and historical text.** A log name is a snapshot, while the table prompt names a current player. Their matching field shapes alone do not make them the same contract.
- **Deal destinations and playback moments.** A card's destination and a moment the UI holds can both describe a bust, but one controls where a card lands and the other controls how long a result stays visible.
- **Adapter interfaces.** The room, heartbeat, storage, and browser adapters expose only what their callers need. Kept those narrow rather than replacing them with broad framework types or forcing test doubles to implement unrelated methods.
