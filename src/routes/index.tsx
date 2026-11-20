import ArrowRight from "@lucide/solid/icons/arrow-right";
import Plus from "@lucide/solid/icons/plus";
import { Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
import { Button } from "@ui-sdk/solid/button";
import { Field, FieldError, FieldLabel } from "@ui-sdk/solid/field";
import { Input } from "@ui-sdk/solid/input";
import { createSignal, For } from "solid-js";

import PlayingCard from "../components/playing-card";
import { ADDITIVE_MODIFIER_KIND } from "../game/cards";
import type { Card } from "../game/cards";
import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "../game/protocol";
import { createRoom } from "../lib/room-functions";
import { paths } from "../router";

const HERO_CARDS: Card[] = [
  { id: 1, kind: "number", value: 3 },
  { id: 2, kind: "number", value: 7 },
  { id: 3, kind: "freeze" },
  { id: 4, kind: ADDITIVE_MODIFIER_KIND, value: 4 },
  { id: 5, kind: "number", value: 12 },
];

const CODE_PATTERN_ATTR = `[${CODE_ALPHABET}${CODE_ALPHABET.toLowerCase()}]{${CODE_LENGTH}}`;

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = createSignal("");
  const [createError, setCreateError] = createSignal("");

  const handleCreateRoom = async () => {
    setCreateError("");

    try {
      const roomCode = await createRoom();
      navigate(paths.room(roomCode));
    } catch {
      setCreateError("Couldn't create a room. Try again.");
    }
  };

  return (
    <main class="home">
      <Title>Hot Streak</Title>
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">A push-your-luck card game</p>
          <h1 class="wordmark">Hot Streak</h1>
          <p class="lede">
            Hit to get another card or Stay to bank your points. Flip 7 unique
            Number cards for 15 bonus points. Two to twelve players, no
            accounts.
          </p>
        </div>
        <ul class="hero-cards" aria-hidden="true">
          <For each={HERO_CARDS}>{(card) => <PlayingCard card={card} />}</For>
        </ul>
      </section>

      <div class="home-actions">
        <section class="panel">
          <h2>Start a room</h2>
          <p class="muted">You'll get a code to share with friends.</p>
          <Button data-variant="solid" onClick={handleCreateRoom}>
            <Plus size={16} />
            Create room
          </Button>
          <p class="error" role="alert">
            {createError()}
          </p>
        </section>

        <section class="panel">
          <h2>Join a room</h2>
          <form
            class="stack"
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = normalizeCode(code());

              if (normalized !== null) {
                navigate(paths.room(normalized));
              }
            }}
          >
            <Field name="code">
              <FieldLabel>Room code</FieldLabel>
              <Input
                class="code-input"
                maxlength={CODE_LENGTH}
                value={code()}
                onValueChange={(value) => {
                  setCode(value);
                }}
                autocomplete="off"
                autocapitalize="characters"
                spellcheck={false}
                pattern={CODE_PATTERN_ATTR}
                placeholder="ABCDE"
                required
              />
              <FieldError match="patternMismatch">
                Room codes are {CODE_LENGTH} letters.
              </FieldError>
            </Field>
            <Button type="submit">
              <ArrowRight size={16} />
              Join room
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
