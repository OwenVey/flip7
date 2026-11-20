import { Button } from "@ui-sdk/solid/button";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/solid/field";
import { Input } from "@ui-sdk/solid/input";
import { createSignal, For, onSettled, Show } from "solid-js";

import { NAME_MAX_LENGTH } from "../game/protocol";
import type { RoomView } from "../game/protocol";

export default function JoinForm(props: {
  room: RoomView | null;
  savedName: string;
  onJoin: (name: string) => void;
}) {
  const [name, setName] = createSignal("");
  let nameInput: HTMLInputElement | undefined;

  onSettled(() => {
    const saved = props.savedName;

    const taken = props.room?.players.some(
      (player) => player.name.toLowerCase() === saved.toLowerCase()
    );

    if (taken !== true) {
      setName(saved);
    }

    nameInput?.focus();
  });

  return (
    <section class="panel join">
      <p class="eyebrow">Room {props.room?.code}</p>
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
      <Show when={props.room !== null && props.room.phase !== "lobby"}>
        <p class="muted">
          A game is in progress. You'll be dealt in from the next round.
        </p>
      </Show>
      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name().trim();

          if (trimmed !== "") {
            props.onJoin(trimmed);
          }
        }}
      >
        <Field name="name">
          <FieldLabel>Your name</FieldLabel>
          <Input
            ref={(element) => {
              nameInput = element;
            }}
            value={name()}
            onValueChange={(value) => {
              setName(value);
            }}
            maxlength={NAME_MAX_LENGTH}
            autocomplete="nickname"
            required
          />
          <FieldDescription>
            No account needed. Other players see this name.
          </FieldDescription>
        </Field>
        <Button type="submit" data-variant="solid">
          Join the table
        </Button>
      </form>
    </section>
  );
}
