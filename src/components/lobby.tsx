import Play from "@lucide/solid/icons/play";
import { Button } from "@ui-sdk/solid/button";
import { createMemo, For, Repeat, Show } from "solid-js";

import { MAX_PLAYERS, MIN_PLAYERS } from "../game/engine";
import type { RoomView } from "../game/protocol";
import type { RoomConnection } from "../lib/room-connection";
import InviteButton from "./invite-button";
import LeaveRoom from "./leave-room";
import RemovePlayer from "./remove-player";

const OPEN_SEATS_SHOWN = 2;

export default function Lobby(props: {
  room: RoomView;
  playerId: string;
  send: RoomConnection["send"];
}) {
  const isHost = () => props.room.hostId === props.playerId;

  const missing = () => Math.max(0, MIN_PLAYERS - props.room.players.length);

  const openSeats = createMemo(() =>
    Math.min(
      Math.max(missing(), OPEN_SEATS_SHOWN - props.room.players.length, 1),
      MAX_PLAYERS - props.room.players.length
    )
  );

  const hostName = () =>
    props.room.players.find((player) => player.id === props.room.hostId)
      ?.name ?? "the host";

  return (
    <div class="lobby-page">
      <header class="page-header">
        <h1>Get your table together</h1>
        <LeaveRoom
          onLeave={() => {
            void props.send({ type: "leave" });
          }}
        />
      </header>

      <div class="lobby">
        <section class="panel invite">
          <h2>Invite friends</h2>
          <p class="room-code" aria-label={`Room code ${props.room.code}`}>
            {props.room.code}
          </p>
          <p class="muted">
            Send the link, or have them enter the code on the home page. No
            accounts needed.
          </p>
          <InviteButton solid />
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>Players</h2>
            <span class="badge" data-tone="muted">
              {props.room.players.length} / {MAX_PLAYERS}
            </span>
          </div>
          <ul class="roster">
            <For each={props.room.players} keyed={(player) => player.id}>
              {(player) => (
                <li data-offline={player().connected ? undefined : ""}>
                  <span class="roster-name">
                    {player().name}
                    {player().id === props.playerId ? " (you)" : ""}
                  </span>
                  <Show when={player().id === props.room.hostId}>
                    <span class="badge">Host</span>
                  </Show>
                  <Show when={!player().connected}>
                    <span class="badge" data-tone="muted">
                      Offline
                    </span>
                  </Show>
                  <Show when={isHost() && player().id !== props.playerId}>
                    <RemovePlayer
                      name={player().name}
                      onRemove={() => {
                        void props.send({
                          playerId: player().id,
                          type: "kick",
                        });
                      }}
                    />
                  </Show>
                </li>
              )}
            </For>
            <Repeat count={openSeats()}>
              {() => (
                <li class="open-seat" aria-hidden="true">
                  Open seat
                </li>
              )}
            </Repeat>
          </ul>
          <Show
            when={isHost()}
            fallback={
              <p class="muted">Waiting for {hostName()} to start the game.</p>
            }
          >
            <Show
              when={missing() === 0}
              fallback={
                <p class="muted">
                  Waiting for {missing()} more{" "}
                  {missing() === 1 ? "player" : "players"} to join.
                </p>
              }
            >
              <Button
                data-variant="solid"
                onClick={async () => await props.send({ type: "start" })}
              >
                <Play size={16} />
                Start game
              </Button>
            </Show>
          </Show>
        </section>

        <section class="panel rules">
          <h2>How to play</h2>
          <ul>
            <li>
              On your turn, <strong>Hit</strong> to get dealt another card or{" "}
              <strong>Stay</strong> to bank your points and exit the round. You
              can Stay once you have a card in front of you.
            </li>
            <li>
              If you get a duplicate Number card, you bust and score zero for
              the round.
            </li>
            <li>
              <strong>Flip 7</strong> unique Number cards to earn 15 bonus
              points and end the round for everyone. Only Number cards count
              toward the Flip 7 bonus.
            </li>
            <li>
              <strong>Action cards</strong> are played on active players.{" "}
              <strong>Freeze</strong> banks the receiving player's points and
              ends their round. <strong>Flip Three</strong> makes them take the
              next three cards, one at a time. <strong>Second Chance</strong> is
              discarded along with your next duplicate Number card.
            </li>
            <li>
              Add up your Number cards, apply the ×2 multiplier if you have it,
              then add points from any other{" "}
              <strong>Score Modifier cards</strong> and the Flip 7 bonus.
            </li>
            <li>
              When a round ends with someone at {props.room.targetScore} or
              more, the highest score wins. A tie for first plays on.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
