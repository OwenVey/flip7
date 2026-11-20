# Hot Streak

A multiplayer push-your-luck card game for 2 to 12 players. Players share a room code or link, pick a display name, and play. There are no accounts.

It's built with Solid 2.0 and ui-sdk, and runs on Cloudflare Workers with one Durable Object per room.

## How to play

The Dealer starts each round by dealing one card to every player. Then players take turns choosing to **Hit** (get dealt another card) or **Stay** (bank their points and exit the round). A duplicate Number card makes you bust and score zero for the round.

**Scoring.** Add up your Number cards, apply the ×2 multiplier if you have it, then add points from any other Score Modifier cards. Flip 7 unique Number cards to earn 15 bonus points and end the round immediately. The round also ends when no active players remain. Once someone reaches 200 points at the end of a round, the player with the most points wins. If the leaders are tied, play continues.

**The deck** has 94 cards:

| Cards                                               | Count  |
| --------------------------------------------------- | ------ |
| Number cards 1 to 12 (n copies of n) and a single 0 | 79     |
| Score Modifier cards +2, +4, +6, +8, +10            | 5      |
| Score Modifier card ×2 (doubles Number card points) | 1      |
| Action cards Freeze, Flip Three, Second Chance      | 3 each |

**Action cards.** When you're dealt Freeze or Flip Three, choose an active player to receive it. You can choose yourself.

- **Freeze**: the receiving player banks their points and exits the round.
- **Flip Three**: that player flips three cards in a row. Any Freeze or Flip Three drawn during the three waits until the third card is flipped.
- **Second Chance**: keep it until you're dealt a duplicate Number card, then discard both cards and stay in the round. If you already have a Second Chance, give the new one to an active player who doesn't have one. If nobody can take it, discard it.

When the deck runs out, the discard pile is shuffled into a new deck.

## Getting started

```bash
pnpm install      # also installs the lefthook pre-commit hook
pnpm dev          # Vite + workerd (Durable Objects included) on http://localhost:3000
```

Open several tabs to play against yourself: each tab joins as its own player.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server with the Worker and Durable Objects running in workerd |
| `pnpm test` | Rules engine and UI tests (Vitest) |
| `pnpm check` / `pnpm fix` | Lint and format with Ultracite; `fix` also writes the fixes |
| `pnpm typecheck` | Regenerates the Worker types, then type-checks the app and the Worker |
| `pnpm build` | Builds the client and the Worker into `.cloudflare/output/v1` |
| `pnpm serve` | Previews the production build |
| `pnpm deploy` | Builds, then runs `cf deploy --prebuilt` (run `pnpm exec cf auth login` first) |

The pre-commit hook runs `ultracite fix` on staged files.

## How it fits together

| Path | What it does |
| --- | --- |
| `src/game/` | The pure rules engine (`engine.ts`), the deck and scoring (`cards.ts`), the WebSocket protocol (`protocol.ts`) and incoming command validation (`client-message.ts`), and the room's grace and expiry clocks (`timers.ts`). The Worker and the browser share it. |
| `worker/index.ts` | The Worker entry. It forwards WebSocket upgrades to the `GameRoom` Durable Object and dispatches pages and server functions through Solid's `virtual:solid-ssr-handler`. |
| `worker/room.ts` | `GameRoom`: the authoritative state for one room, kept in Durable Object storage and served over hibernatable WebSockets. |
| `src/lib/room-functions.ts` | Typed Solid server functions that create rooms and check whether a room exists. |
| `src/lib/room-connection.ts` | The browser's socket client, with heartbeats and reconnects. |
| `src/routes/` | `/` creates or joins a room; `/room/:code` shows the lobby or the table. |
| `src/components/` | The lobby, the table, cards and the room controls, built on ui-sdk. |

- **Identity.** Joining returns a random token, kept in `sessionStorage`, so a refresh puts you back in your seat. A new tab counts as a new player. Your display name is remembered in `localStorage`.
- **Host.** The host starts the game and can remove players. If the host disconnects for 20 seconds, the next connected player becomes host.
- **Offline players.** If the game waits on a player who has gone offline for 30 seconds, it plays for them: they stay on their turn, and an action card they must hand out goes to another player. These clocks only run while someone else is online.
- **Cleanup.** A room deletes its storage 24 hours after the last move or the last socket closing, whichever is later, once no sockets are left.

## Cloudflare config

`cloudflare.config.ts` defines the `hot-streak` Worker: its entrypoint, the `GAME_ROOM` Durable Object binding, and the `GameRoom` export (SQLite-backed). It uses the `cf` CLI and `@cloudflare/vite-plugin` 2, which are both release candidates. There is no `wrangler.jsonc`.

Builds go to `.cloudflare/output/v1`, and the Worker's `Env` types are generated into `.cloudflare/types`. Both are gitignored.

The app and the Worker have separate tsconfigs, so the Workers runtime types never mix with the DOM types.
