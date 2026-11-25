import Trophy from "@lucide/solid/icons/trophy";
import { createAlertDialogController } from "@ui-sdk/solid/alert-dialog";
import { createPopoverController } from "@ui-sdk/solid/popover";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onSettled,
  Show,
} from "solid-js";

import { availableMoves } from "../game/moves";
import type { RoomView } from "../game/protocol";
import { pointsOf } from "../lib/deal-playback";
import type { ChatControls } from "../lib/room-connection";
import { passDealerChip } from "../lib/table-motion";
import type { ChipSpot } from "../lib/table-motion";
import ActionBar from "./action-bar";
import CardTooltips from "./card-tooltips";
import ChatSheet from "./chat-sheet";
import Confetti from "./confetti";
import GameLog from "./game-log";
import GameOverDialog from "./game-over-dialog";
import InviteButton from "./invite-button";
import Leaderboard from "./leaderboard";
import LeaveRoom from "./leave-room";
import { RoomSettingsMenu } from "./room-settings";
import RoundPlayer from "./round-player";
import ScrollFade from "./scroll-fade";
import { SpectatorActions, WatcherCount } from "./spectator-controls";
import type { Spectator } from "./spectator-controls";
import { samePlayerIds, SCORES_TITLE } from "./table-common";
import type {
  DealProps,
  RoundPointsByPlayer,
  TableProps,
} from "./table-common";
import TableMoreMenu from "./table-more-menu";
import TableSheet from "./table-sheet";

const SHEET_TABLE_QUERY = "(width < 64rem), (height <= 30rem)";

export default function Table(
  props: TableProps &
    DealProps &
    RoundPointsByPlayer & {
      chat: ChatControls;
      /** Other players typing a chat message, by player ID. */
      typing: readonly string[];
      /**
       * The room as last confirmed, ahead of deal playback. Settings read it so
       * a change shows as soon as the room accepts it, not after the deal.
       */
      latestRoom?: RoomView | null;
      /** A Spectator's Join and Leave, shown where a player's Leave and ⋯ go. */
      spectator?: Spectator;
    }
) {
  const moves = createMemo(() => availableMoves(props.room, props.playerId));
  const chat = () => (props.playerId === null ? undefined : props.chat);

  const playerIds = createMemo(() => props.room.players.map(({ id }) => id), {
    equals: samePlayerIds,
  });

  const settings = createPopoverController();
  const leave = createAlertDialogController();

  const removePlayer = (playerId: string) => {
    void props.send({ playerId, type: "kick" });
  };

  const chooseTarget = (targetId: string) => {
    const { choice } = moves();

    if (
      props.actionsDisabled === true ||
      choice === null ||
      !choice.targets.includes(targetId)
    ) {
      return;
    }

    const { forId } = choice;
    void props.send({
      ...(forId !== undefined && { forId }),
      targetId,
      type: "choose",
    });
  };

  let chipSpot: ChipSpot | null = null;

  createEffect(
    () => props.room.dealerId,
    (dealerId) => {
      chipSpot = passDealerChip(dealerId, chipSpot);
    }
  );

  const [sheetTable, setSheetTable] = createSignal(false);

  onSettled(() => {
    const query = globalThis.matchMedia?.(SHEET_TABLE_QUERY);

    const sync = () => {
      setSheetTable(query?.matches);
    };

    sync();
    query?.addEventListener?.("change", sync);

    return () => {
      query?.removeEventListener?.("change", sync);
    };
  });

  const [scoresOpen, setScoresOpen] = createSignal(false);
  const [logOpenedAt, setLogOpenedAt] = createSignal<number | null>();

  const resultsRound = createMemo(() =>
    props.room.phase === "roundOver" && props.dealing !== true
      ? props.room.round
      : null
  );

  const sheetResultsRound = createMemo(() => {
    const round = resultsRound();

    return round !== null && globalThis.matchMedia?.(SHEET_TABLE_QUERY).matches
      ? round
      : null;
  });

  const logOpen = () => {
    const openedAt = logOpenedAt();
    const round = sheetResultsRound();

    return openedAt !== undefined && (round === null || openedAt === round);
  };

  createEffect(resultsRound, (round, previous) => {
    if (round !== null && sheetResultsRound() === round) {
      setLogOpenedAt(undefined);
      setScoresOpen(true);
    } else if (previous !== null && previous !== undefined) {
      setScoresOpen(false);
    }
  });

  return (
    <CardTooltips>
      <div class="table" data-phase={props.room.phase}>
        <header class="table-header">
          <h1>Round {props.room.round}</h1>
          <div class="row">
            <WatcherCount
              count={(props.latestRoom ?? props.room).spectatorCount}
              watching={props.playerId === null}
            />
            <TableSheet
              open={scoresOpen()}
              onOpenChange={(open) => {
                setScoresOpen(open);
              }}
              title={SCORES_TITLE}
              triggerLabel={SCORES_TITLE}
              shortLabel={SCORES_TITLE}
              trigger={<Trophy size={16} aria-hidden="true" />}
            >
              <Leaderboard
                room={props.room}
                playerId={props.playerId}
                roundPoints={props.roundPoints}
              />
            </TableSheet>
            <ChatSheet
              open={logOpen()}
              onOpenChange={(open) => {
                setLogOpenedAt(open ? sheetResultsRound() : undefined);
              }}
              log={props.room.log}
              playerId={props.playerId}
              chat={chat()}
              players={props.room.players}
              typing={props.typing}
              logInSheet={sheetTable()}
            />
            <InviteButton brief collapsible />
            <Show when={moves().host.configure}>
              <RoomSettingsMenu
                room={props.latestRoom ?? props.room}
                controller={settings}
                collapsible
                onChange={(changes) => {
                  void props.send({ ...changes, type: "configure" });
                }}
              />
            </Show>
            <Show
              when={props.playerId !== null}
              fallback={
                <Show when={props.spectator}>
                  {(spectator) => (
                    <SpectatorActions
                      room={props.latestRoom ?? props.room}
                      join={spectator().join}
                      onStopWatching={spectator().onLeave}
                    />
                  )}
                </Show>
              }
            >
              <LeaveRoom
                disabled={props.offline}
                controller={leave}
                collapsible
                onLeave={() => {
                  void props.send({ type: "leave" });
                }}
              />
              <TableMoreMenu
                leave={leave}
                leaveDisabled={props.offline}
                settings={moves().host.configure ? settings : undefined}
              />
            </Show>
          </div>
        </header>

        <ActionBar
          room={props.room}
          playerId={props.playerId}
          send={props.send}
          actionsDisabled={props.actionsDisabled}
          playback={{
            dealing: props.dealing === true,
            moment: props.dealMoment ?? null,
            roundPoints: props.roundPoints,
            step: props.dealStep ?? null,
          }}
        />

        <div class="table-body">
          <div class="seats">
            <For each={playerIds()}>
              {(id, index) => (
                <Show when={props.room.players[index()]}>
                  {(player) => (
                    <RoundPlayer
                      player={player()}
                      room={props.room}
                      playerId={props.playerId}
                      actionsDisabled={props.actionsDisabled}
                      removeDisabled={props.offline}
                      roundPoints={pointsOf(props.roundPoints, id)}
                      dealing={props.dealing === true}
                      dealMoment={props.dealMoment ?? null}
                      dealStep={props.dealStep}
                      moves={moves()}
                      onPick={chooseTarget}
                      onRemove={removePlayer}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>

          <div class="stack table-sidebar">
            <section class="panel leaderboard-panel">
              <h2>{SCORES_TITLE}</h2>
              <ScrollFade
                class="leaderboard-body"
                viewportClass="leaderboard-scroll"
                label={SCORES_TITLE}
              >
                <Leaderboard
                  room={props.room}
                  playerId={props.playerId}
                  roundPoints={props.roundPoints}
                />
              </ScrollFade>
            </section>
            <Show when={!sheetTable()}>
              <GameLog
                log={props.room.log}
                playerId={props.playerId}
                chat={chat()}
                players={props.room.players}
                typing={props.typing}
              />
            </Show>
          </div>
        </div>
        <div class="flight-layer" data-flight-layer="" aria-hidden="true" />
        <div class="flight-layer" data-chip-layer="" aria-hidden="true" />
        <Show when={props.room.phase === "gameOver" && props.dealing !== true}>
          <Confetti />
          <GameOverDialog
            room={props.room}
            playerId={props.playerId}
            canPlayAgain={moves().host.start}
            canReturnToLobby={moves().host.lobby}
            actionsDisabled={props.actionsDisabled}
            onPlayAgain={() => {
              void props.send({ type: "start" });
            }}
            onReturnToLobby={() => {
              void props.send({ type: "lobby" });
            }}
          />
        </Show>
      </div>
    </CardTooltips>
  );
}
