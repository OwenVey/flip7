import { Button } from "@ui-sdk/solid/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@ui-sdk/solid/field";
import { Input } from "@ui-sdk/solid/input";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";

import { MAX_PLAYERS } from "../game/engine";
import { NAME_MAX_LENGTH } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import { paths } from "../router";

export default function JoinForm(props: {
  room: RoomView | null;
  savedName: string;
  onJoin: (name: string) => void;
  joining?: boolean;
  unavailable?: boolean;
  error?: string;
  onEdit?: () => void;
}) {
  const [typed, setTyped] = createSignal<string | null>(null);
  const [emptyName, setEmptyName] = createSignal(false);
  const full = () => (props.room?.players.length ?? 0) >= MAX_PLAYERS;
  const error = () => (emptyName() ? "Enter your name." : (props.error ?? ""));

  const unavailable = () =>
    props.joining === true || props.unavailable === true || props.room === null;

  const suggestion = createMemo(() => {
    const saved = props.savedName;

    const taken = props.room?.players.some(
      (player) => player.name.toLowerCase() === saved.toLowerCase()
    );

    return taken === true ? "" : saved;
  });

  const name = () => typed() ?? suggestion();
  let nameInput: HTMLInputElement | undefined;

  onSettled(() => {
    nameInput?.focus();
  });

  return (
    <section class="panel join">
      <h1>Take a seat</h1>
      <Show when={props.room?.players.length}>
        <p class="muted">
          At the table:{" "}
          <For each={props.room?.players ?? []} keyed={(player) => player.id}>
            {(player, index) => (
              <>
                {index() > 0 ? ", " : ""}
                {player().name}
              </>
            )}
          </For>
        </p>
      </Show>
      <Show
        when={!full() && props.room !== null && props.room.phase !== "lobby"}
      >
        <p class="muted">
          A game is in progress. You'll be dealt in from the next round.
        </p>
      </Show>
      <Show
        when={!full() || props.joining}
        fallback={
          <>
            <output>
              This room is full ({MAX_PLAYERS} players). You can join if a seat
              opens up.
            </output>
            <a class="link" href={paths()}>
              Try another room code
            </a>
          </>
        }
      >
        <form
          class="stack"
          novalidate
          onSubmit={(event) => {
            event.preventDefault();

            if (unavailable() || full()) {
              return;
            }

            const trimmed = name().trim();

            if (!trimmed) {
              setEmptyName(true);
              nameInput?.focus();

              return;
            }

            setTyped(trimmed);
            props.onJoin(trimmed);
          }}
        >
          <Field name="name" invalid={error() === "" ? undefined : true}>
            <FieldLabel>Your name</FieldLabel>
            <Input
              ref={(element) => {
                nameInput = element;
              }}
              value={name()}
              onValueChange={(value) => {
                setTyped(value);
                setEmptyName(false);
                props.onEdit?.();
              }}
              readonly={props.joining === true}
              maxlength={NAME_MAX_LENGTH}
              autocomplete="nickname"
              required
            />
            <FieldDescription>
              No account needed. Other players see this name.
            </FieldDescription>
            <FieldError role="alert">{error()}</FieldError>
          </Field>
          <Button type="submit" data-variant="solid" disabled={unavailable()}>
            {props.joining === true ? "Joining…" : "Join the table"}
          </Button>
        </form>
      </Show>
    </section>
  );
}
