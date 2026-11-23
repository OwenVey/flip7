# Flip 7 rules and engine acceptance criteria

This app implements base Flip 7, ruleset 3.1. Standard play is for 3+ players. The app also supports regular competitive play with two players, caps rooms at 16, and uses one deck. The default winning score is 200. Hosts can choose 100 or 300 as room variants. The rulebook describes a separate challenge for one or two players and recommends a second deck above 18 players. If multi-deck support is added, specify how multiple ×2 cards interact. [3.1 rulebook](https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2025/12/FLIP_7-RULES.pdf)

**Keep the normal turn cursor, opening cursor, outstanding move, and forced-draw state separate.** A Flip Three can move the draw and the next choice across several players. Resume from the original normal turn owner or the current opening slot once all effects resolve. At most one player owes a move at any time.

## Deck and card identity

| Type | Single-deck composition |
| --- | --- |
| Number cards | 79 total. One 0 and exactly `n` copies of each value `n` from 1 through 12. |
| Score modifiers | One each of +2, +4, +6, +8, +10, and ×2. |
| Action cards | Three each of Freeze, Flip Three, and Second Chance. |
| Total | 94 playable cards. |

- Each physical card has its own ID. Copies of the same Number share a bust value and keep separate identities through discards, reshuffles, and deal playback.
- Only Number values count toward busts and Flip 7. Number 2, +2, and ×2 have different rule effects. Zero adds no points and counts as a distinct Number.

## Opening deal

1. Shuffle the deck at game start and choose a dealer. Use fixed clockwise player order, starting to the dealer's left and including the dealer last.
2. Start every participating player active. Deal one face-up card at each active player's opening slot. Resolve the card and any actions before advancing the opening cursor.
3. Allow Freeze and Flip Three to target active players who have yet to reach their slots. Skip anyone who is already Frozen or busted when their slot arrives.
4. An opening card can be any card type. If the drawer gives away their opening action, resume the opening pass at the next slot once the action resolves. The drawer can finish the pass with an empty display.
5. **Reported publisher clarification.** If a player already drew through Flip Three before their opening slot, offer Hit or Stay there in place of a compulsory draw. If those draws left them empty, only Hit is legal. Resume the opening pass once that move and its effects resolve. [Community FAQ, case 15](https://goblins.net/files/images/flip_7_faq_version_1.4.pdf)

[Dized gameplay rules](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/wGXhPMBFQ2i1ymgjH16VkA/how-to-play) · [Dized FAQ](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq)

## Normal turns

- **Hit** draws one card. Resolve that card and all resulting actions before advancing clockwise from the original turn owner to the next active player. A forced draw leaves the recipient's later normal turn in place.
- **Stay** locks the player's round score and makes them inactive. Any held card qualifies, including a lone 0, ×2, additive modifier, or Second Chance. An empty player can only Hit.
- Only active players take normal turns or receive targeted actions. Stayed, Frozen, and busted players sit out the rest of the round. Online presence is independent of eligibility. The room can make a legal move for an offline player through the host or stall handling.

[Dized gameplay rules](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/wGXhPMBFQ2i1ymgjH16VkA/how-to-play) · [Dized FAQ](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq)

## Resolve each revealed card

| Reveal | Resolution |
| --- | --- |
| New Number value | Add it to the drawer's Number cards. A seventh distinct value ends the round immediately. |
| Duplicate Number without Second Chance | Bust the drawer. They score zero for the entire round, including modifiers. Other active players continue. |
| Duplicate Number with Second Chance | Automatically discard the duplicate and the held Second Chance. Keep the original Number and remain active. The reveal uses the current draw. |
| Score modifier | Keep it with the drawer. It affects scoring only. |
| Freeze | The drawer chooses any active player, including themself. When the effect executes, the target locks their current score and becomes inactive. An empty target banks zero. Second Chance has no effect on Freeze. |
| Flip Three | The drawer chooses any active player, including themself. Resolve the forced draws below. |
| Second Chance | Keep it if the drawer has none. Otherwise keep the original and give the new card to another active player without one. Discard the extra if nobody qualifies. |

The drawer owns the target choice. A lone active player must target themself with Freeze or Flip Three. A sole legal recipient can be assigned automatically. Unused Second Chance cards go to discard at round cleanup.

[3.1 rulebook](https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2025/12/FLIP_7-RULES.pdf) · [The Op FAQ](https://theop.games/pages/flip-7-faqs) · [Dized Second Chance rules](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/jxfRCwMWS7yZ2fZYyPg/second-chance)

## Flip Three

### Forced draws

1. Give the target three forced draws, resolved one at a time. The triggering Flip Three is outside that budget. There is no Hit or Stay between forced draws.
2. Every reveal spends one draw, including a modifier, Second Chance, a held action card, or a duplicate canceled by Second Chance.
3. Resolve Second Chance immediately. It can save a duplicate later in the same sequence. Resolve any gift choice before the next draw. A saved duplicate leaves the remaining budget intact. On a normal Hit, a saved duplicate completes that Hit and play advances.
4. Hold any Freeze or Flip Three revealed during the sequence without choosing a target or applying it yet.
5. On a bust, stop drawing and discard that sequence's held, unassigned actions. A Second Chance already given away stays with its recipient. Unrelated queued effects still execute if the round is live.
6. On a seventh distinct Number, end the round immediately. Cancel remaining forced draws, held assignments, queued effects, and opening slots. Score the round.
7. After three draws with the target still active, that player assigns the held actions. Each Flip Three that executes starts a fresh three-draw budget.

[Dized Flip Three rules](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/au24_PEbSGOx0k7WybVJoQ/flip-three) · [Dized FAQ](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq) · [The Op developer's revised-rule clarification](https://boardgamegeek.com/thread/3380455/bust-or-no-bust-on-flip-3)

### Held action assignment and execution

This ordering follows the reported publisher ruling and the community's nested example. [Community FAQ, case 13](https://goblins.net/files/images/flip_7_faq_version_1.4.pdf) · [Nested action-stack discussion](https://boardgamegeek.com/thread/3688197/action-card-stacks)

1. Assign the entire batch in reveal order before applying any of it. Multiple actions may target the same active player. A queued Freeze leaves its target active until it executes.
2. Append the assigned batch behind effects already waiting. Execute the queue in order. When an effect reaches its slot, discard it if its target is inactive or has left. Keep the assigned target fixed.
3. If an executed Flip Three reveals more held actions, resolve its draws and assign its new batch. Append that batch behind the effects already waiting.

| Queue | Result |
| --- | --- |
| Freeze → B, Flip Three → B | B freezes. Discard the Flip Three at its execution slot without drawing. |
| Flip Three → B, Freeze → B | B draws first. If B survives and the round is live, Freeze banks the resulting score. |
| Flip Three → B, Flip Three → B | B takes both sequences if still active. B assigns new actions they personally reveal. The second queued card keeps its original target. |
| Flip Three → B, Freeze → C, with B assigning a newly revealed Flip Three to C | C is eligible at assignment. The earlier Freeze executes first, so the later Flip Three is discarded without drawing. |

## Scoring and game end

```ts
roundScore = busted
  ? 0
  : numberSum * (hasDouble ? 2 : 1) +
    additiveModifierSum +
    (completedFlip7 ? 15 : 0);
```

- ×2 applies only to the Number subtotal. Add the additive modifiers and Flip 7 bonus afterward. With +2, +6, and ×2 and no Numbers, the score is 8. An empty display or a lone Second Chance scores zero.
- Stay and Freeze lock the round score immediately. Credit each participating player once, at round settlement.
- A Flip 7 ends the round and awards +15 only to the player who completed it. All other non-busted players score what they hold, including those still active.
- A round also ends when no active players remain. A lone active player continues. See the empty-piles fallback below for the additional digital end condition.
- Apply all round scores before checking for a winner. A unique leader at or above the winning score wins. If the highest total reaches the winning score and is tied, everyone plays another full round with cumulative scores carried forward. Repeat until the lead is unique. Any player can win the tie-break, including someone outside the original tie. The default threshold includes a tie at exactly 200.

[3.1 rulebook](https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2025/12/FLIP_7-RULES.pdf) · [The Op scoring FAQ](https://theop.games/pages/flip-7-faqs) · [Dized tie FAQ](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq)

## Card lifecycle and reshuffles

- At round cleanup, move remaining table cards to discard and reset round state. Keep the unused draw pile and rotate the dealer one player to the left for the next round.
- On a required draw from an empty deck, shuffle only the discard pile and resume the same draw with its original context and remaining budget. Table cards stay out of the reshuffle, including the hands and bust cards of inactive players. In-flight and queued actions remain out of the discard pile.
- A used Second Chance and the duplicate it saved go to discard immediately. **Reported discard timing.** A resolved Flip Three enters discard once its forced draws finish or terminate. An applied Freeze stays with its target until round cleanup. [Community FAQ, cases 2, 4, and 9](https://goblins.net/files/images/flip_7_faq_version_1.4.pdf)
- **Digital fallback.** If a required draw finds both piles empty, end the round, clear remaining action work, and settle the scores normally. Current-round table cards stay out of the deck.
- **Eviction.** A player who leaves or is kicked stops participating. Hold their table cards until the same cleanup as the rest of the table, including applied Freeze, unused Second Chance, and their bust card. Effects queued for that player stay in order and are discarded when their execution slot arrives. Remove the player from outstanding legal targets. If the chooser leaves before completing an assignment batch, cancel that unfinished batch.

[Dized next-round and reshuffle rules](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/wzjlmw8LSdeycfWo_EvxOg/starting-the-next-round)

## Outstanding moves and reconnects

- Persist the outstanding move independently of the turn cursor, along with any forced-draw budget, held cards, and queued effects. The player the game is waiting on can be the opener, normal turn owner, player assigning held actions, or Second Chance giver.
- Reconnecting to an unresolved move restores the same actor and legal targets, with the same draw already accounted for. If the room has legitimately advanced while the player was away, show the current authoritative state.

## Deterministic acceptance fixtures

Use scripted draw piles. Assert player state, card IDs and zones, draws consumed, pending choice and legal targets, and the next actor where relevant. See [rules acceptance tests](../src/game/rules-acceptance.test.ts) and [engine tests](../src/game/engine.test.ts).

| Fixture | Expected result |
| --- | --- |
| A opens with Freeze and targets B before B's opening slot | B banks zero, receives no opener, and the opening pass continues. |
| A opens with Flip Three and B survives with cards before B's slot | B gets Hit or Stay at that slot. If B is empty, only Hit is offered. |
| A gives away their opening Freeze and stays empty | A remains active and can only Hit on their first normal turn. The opening pass moves on after the Freeze. |
| A holds only 0, only ×2, or only Second Chance | Stay is legal and scores zero in each case. |
| A holds Number 2, then draws +2 and ×2 | A has one distinct Number, survives both draws, and banks 6. |
| A holds 9 and Second Chance, then Hits another 9 | The original 9 stays. The duplicate and Second Chance go to discard. Play advances after one draw. |
| A holds 9 and takes forced draws `[Second Chance, 9, 4]` | Exactly three draws. A stays active with the original 9 and the 4. |
| A already holds Second Chance and reveals another on forced draw one | Pause to resolve the gift before draw two. Discard the extra if nobody qualifies. A retains the original. |
| A holds 9 and starts forced draws `[Freeze, 9, …]` without protection | A busts on draw two. Discard the held Freeze unassigned and leave draw three in the deck. |
| A has six Numbers and starts forced draws `[Flip Three, seventh distinct Number, …]` | End the round on draw two. Discard the held Flip Three unassigned and leave draw three in the deck. |
| A has five Numbers and takes forced draws `[+4, Second Chance, sixth distinct Number]` | Exactly three draws, six distinct Numbers, and zero Flip 7 bonus. |
| A completes Flip 7 with 0–6, ×2, and +8 | A earns 65. Every other non-busted player scores their cards. Busted players earn zero. |
| A Hits, assigns Flip Three to C, and C assigns a new Flip Three to D | B takes the next normal turn if active. If the chain Froze B, continue clockwise past B from A's turn anchor. |
| A deferred batch targets B with Freeze, then Flip Three, and in a separate fixture with the order reversed | Assign both before either applies. Freeze first yields zero forced draws. Flip Three first permits the draws and Freeze banks the result if B survives. |
| A queued Flip Three targets B before a queued Freeze targets C, and B assigns another Flip Three to C | C is eligible at assignment. The earlier Freeze runs first and the newly assigned Flip Three is discarded without drawing. |
| The deck empties during Flip Three while an inactive player holds cards | Reshuffle eligible discards only. Preserve held cards, queued effects, and the remaining draw budget. |
| A player is evicted with table cards before a reshuffle | Their table cards enter discard at round cleanup. A queued effect targeting the evicted player enters discard at its execution slot. |
| Totals settle at `[220, 230, 198]`, or at `[200, 200, 198]` with a later round at `[207, 209, 215]` | B wins the first game. Everyone plays again after the tie. C wins the tie-break round. |
| Save and restore during a Flip Three interrupted by a Second Chance gift | Preserve the exact choice and targets, draw pile, remaining budget, and next normal actor. Resume from the choice without repeating its draw. |
