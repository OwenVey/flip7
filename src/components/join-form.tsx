import Eye from "@lucide/solid/icons/eye";
import { Button } from "@ui-sdk/solid/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@ui-sdk/solid/field";
import { Input } from "@ui-sdk/solid/input";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { ParentProps } from "solid-js";

import { pickAvatar, takenAvatars } from "../game/avatars";
import { MAX_PLAYERS } from "../game/engine";
import { MAX_SPECTATORS } from "../game/moves";
import { sameName } from "../game/names";
import type { RoomPreview } from "../game/protocol";
import { clipText, NAME_TEXT_LIMIT } from "../game/text";
import { paths } from "../router";
import AvatarPicker from "./avatar-picker";

const Frame = (props: ParentProps<{ embedded: boolean }>) => (
  <Show
    when={props.embedded}
    fallback={
      <section class="panel join">
        <h1>Take a seat</h1>
        {props.children}
      </section>
    }
  >
    <div class="stack join-embedded">{props.children}</div>
  </Show>
);

const FINE_POINTER_QUERY = "(pointer: fine)";

export interface JoinFormProps {
  /** Leaves out the card and heading so a dialog can frame the form. */
  embedded?: boolean;
  room: Pick<RoomPreview, "phase" | "players" | "spectatorCount"> | null;
  locked?: boolean;
  onWatch?: () => void;
  watchError?: string;
  watchPending?: boolean;
  savedName: string;
  savedAvatar: number | null;
  onJoin: (name: string, avatar: number) => void;
  joining?: boolean;
  unavailable?: boolean;
  error?: string;
  onEdit?: () => void;
}

export default function JoinForm(props: JoinFormProps) {
  const [typed, setTyped] = createSignal<string | null>(null);
  const [picked, setPicked] = createSignal<number | null>(null);
  const seed = Math.random();

  const avatar = () =>
    picked() ??
    props.savedAvatar ??
    pickAvatar(seed, takenAvatars(props.room?.players ?? []));

  const [emptyName, setEmptyName] = createSignal(false);
  const full = () => (props.room?.players.length ?? 0) >= MAX_PLAYERS;

  const joinLocked = () =>
    props.locked === true && (props.room?.players.length ?? 0) > 0;

  const watchFull = () => (props.room?.spectatorCount ?? 0) >= MAX_SPECTATORS;
  const error = () => (emptyName() ? "Enter your name." : (props.error ?? ""));

  const unavailable = () =>
    props.joining === true ||
    props.watchPending === true ||
    props.unavailable === true ||
    props.room === null;

  const suggestion = createMemo(() => {
    const saved = props.savedName;

    const taken = props.room?.players.some((player) =>
      sameName(player.name, saved)
    );

    return taken === true ? "" : saved;
  });

  const name = () => typed() ?? suggestion();
  let nameInput: HTMLInputElement | undefined;
  const [nameField, setNameField] = createSignal<HTMLDivElement>();

  onSettled(() => {
    if (
      props.embedded !== true &&
      globalThis.matchMedia?.(FINE_POINTER_QUERY).matches
    ) {
      nameInput?.focus();
    }
  });

  return (
    <Frame embedded={props.embedded === true}>
      <Show when={props.room?.players.length}>
        <p class="muted join-seated">
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
          {props.room?.phase === "gameOver"
            ? "You'll play in the next game."
            : "A game is in progress. You'll be dealt in next round."}
        </p>
      </Show>
      <Show when={props.locked}>
        <p class="muted">
          {joinLocked()
            ? "This room is locked. Ask the host to unlock it."
            : "This room is locked to spectators."}
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

            if (unavailable() || full() || joinLocked()) {
              return;
            }

            const trimmed = clipText(name().trim(), NAME_TEXT_LIMIT).trim();

            if (!trimmed) {
              setEmptyName(true);
              nameInput?.focus();

              return;
            }

            setTyped(trimmed);
            props.onJoin(trimmed, avatar());
          }}
        >
          <Field name="name" invalid={error() === "" ? undefined : true}>
            <FieldLabel>Your name</FieldLabel>
            <div
              class="name-row"
              ref={(element) => {
                setNameField(element);
              }}
            >
              <AvatarPicker
                anchor={nameField()}
                value={avatar()}
                onChange={(next) => {
                  setPicked(next);
                }}
                disabled={props.joining === true}
              />
              <Input
                ref={(element) => {
                  nameInput = element;
                }}
                value={name()}
                onValueChange={(value, details) => {
                  const next = clipText(value, NAME_TEXT_LIMIT);

                  if (next !== value && next === name()) {
                    details.cancel();

                    return;
                  }

                  setTyped(next);
                  setEmptyName(false);
                  props.onEdit?.();
                }}
                readonly={props.joining === true}
                autocomplete="nickname"
                enterkeyhint="go"
                placeholder="What should we call you?"
                required
              />
            </div>
            <FieldDescription>
              No account needed. Tap your avatar to change it.
            </FieldDescription>
            <FieldError role="alert">{error()}</FieldError>
          </Field>
          <Button
            type="submit"
            data-variant="solid"
            disabled={unavailable() || joinLocked()}
          >
            {props.joining === true ? "Joining…" : "Join room"}
          </Button>
        </form>
      </Show>
      <Show when={props.onWatch}>
        <div class="join-watch">
          <p class="join-divider" aria-hidden="true">
            <span>or</span>
          </p>
          <Button
            onClick={() => props.onWatch?.()}
            disabled={unavailable() || props.locked === true || watchFull()}
            aria-describedby="join-watch-hint"
          >
            <Eye size={16} aria-hidden="true" />
            {props.watchPending === true
              ? "Connecting…"
              : "Watch without joining"}
          </Button>
          <p id="join-watch-hint" class="muted join-watch-hint">
            No name needed. You can take a seat any time.
          </p>
          <Show when={watchFull() && (props.watchError ?? "") === ""}>
            <p class="muted">The spectator limit has been reached.</p>
          </Show>
          <Show when={(props.watchError ?? "") !== "" && props.locked !== true}>
            <p class="form-error" role="alert">
              {props.watchError}
            </p>
          </Show>
        </div>
      </Show>
    </Frame>
  );
}
