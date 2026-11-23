import ArrowRight from "@lucide/solid/icons/arrow-right";
import Plus from "@lucide/solid/icons/plus";
import { Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
import { Button } from "@ui-sdk/solid/button";
import { Field, FieldError, FieldLabel } from "@ui-sdk/solid/field";
import {
  createOTPInputController,
  OTPInput,
  OTPInputGroup,
  OTPInputSlot,
} from "@ui-sdk/solid/otp-input";
import { createSignal, For, Repeat } from "solid-js";

import PageMeta, {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
} from "../components/page-meta";
import PlayingCard from "../components/playing-card";
import RulesDialog from "../components/rules-dialog";
import { ADDITIVE_MODIFIER_KIND } from "../game/cards";
import type { Card } from "../game/cards";
import { TARGET_SCORE } from "../game/engine";
import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "../game/protocol";
import { createRoom, roomExists } from "../lib/room-functions";
import { paths } from "../router";

const HERO_CARDS: Card[] = [
  { id: 1, kind: "number", value: 3 },
  { id: 2, kind: "number", value: 7 },
  { id: 3, kind: "freeze" },
  { id: 4, kind: ADDITIVE_MODIFIER_KIND, value: 4 },
  { id: 5, kind: "number", value: 12 },
];

const HERO_FACTS = ["2–16 players", "No accounts", "Free to play"];

const HOME_TITLE = `${SITE_NAME} · A push-your-luck card game`;

const GAME_STRUCTURED_DATA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "VideoGame",
  applicationCategory: "Game",
  description: SITE_DESCRIPTION,
  gamePlatform: "Web browser",
  genre: ["Card game", "Party game"],
  name: SITE_NAME,
  numberOfPlayers: { "@type": "QuantitativeValue", maxValue: 16, minValue: 2 },
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  operatingSystem: "Any",
  playMode: "MultiPlayer",
  url: `${SITE_ORIGIN}/`,
});

const CODE_CHARACTER_PATTERN = new RegExp(
  `[${CODE_ALPHABET}${CODE_ALPHABET.toLowerCase()}]`,
  "u"
);

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = createSignal("");
  const [createError, setCreateError] = createSignal("");
  const [codeError, setCodeError] = createSignal("");
  const [pending, setPending] = createSignal<"create" | "join" | null>(null);
  const codeInput = createOTPInputController();

  const handleCreateRoom = async () => {
    if (pending() !== null) {
      return;
    }

    setPending("create");
    setCreateError("");

    try {
      const roomCode = await createRoom();
      navigate(paths.room(roomCode));
    } catch {
      setCreateError("Couldn't create a room. Try again.");
    } finally {
      setPending(null);
    }
  };

  const handleJoinRoom = async (event: SubmitEvent) => {
    event.preventDefault();

    if (pending() !== null) {
      return;
    }

    const normalized = normalizeCode(code());

    if (normalized === null) {
      setCodeError(`Enter the ${CODE_LENGTH}-letter room code.`);
      codeInput.focus();

      return;
    }

    setCodeError("");
    setPending("join");

    try {
      const exists = await roomExists(normalized).catch(() => null);

      if (exists === false) {
        setCodeError("Room not found. Check the code and try again.");

        return;
      }

      navigate(paths.room(normalized));
    } finally {
      setPending(null);
    }
  };

  return (
    <main class="home">
      <Title>{HOME_TITLE}</Title>
      <PageMeta title={HOME_TITLE} path={paths()} />
      <script type="application/ld+json" innerHTML={GAME_STRUCTURED_DATA} />
      <section class="hero">
        <div class="hero-copy">
          <h1 class="wordmark">Flip 7</h1>
          <p class="lede">
            Hit for another card or Stay to bank your points. Flip 7 for a
            bonus.
          </p>
          <ul class="hero-facts">
            <For each={HERO_FACTS}>{(fact) => <li>{fact}</li>}</For>
          </ul>
        </div>
        <ul class="hero-cards" aria-hidden="true">
          <For each={HERO_CARDS}>{(card) => <PlayingCard card={card} />}</For>
        </ul>
      </section>

      <section class="panel home-actions" aria-labelledby="play-heading">
        <h2 id="play-heading">Play</h2>
        <div class="home-create">
          <Button
            data-variant="solid"
            disabled={pending() !== null}
            onClick={handleCreateRoom}
          >
            <Plus size={16} />
            {pending() === "create" ? "Creating room…" : "Create room"}
          </Button>
          <p class="home-hint">You'll get a link to share with friends.</p>
          <p class="error" role="alert">
            {createError()}
          </p>
        </div>
        <p class="home-divider" aria-hidden="true">
          or join with a code
        </p>
        <form
          class="home-join"
          novalidate
          onSubmit={(event) => {
            void handleJoinRoom(event);
          }}
        >
          <Field name="code" invalid={codeError() ? true : undefined}>
            <FieldLabel class="sr-only">Room code</FieldLabel>
            <OTPInput
              autoComplete="off"
              controller={codeInput}
              inputMode="text"
              maxLength={CODE_LENGTH}
              onValueChange={(value) => {
                setCode(value);
                setCodeError("");
              }}
              pattern={CODE_CHARACTER_PATTERN}
              readOnly={pending() === "join"}
              required
              value={code()}
            >
              <OTPInputGroup class="code-input">
                <Repeat count={CODE_LENGTH}>
                  {(index) => <OTPInputSlot index={index} />}
                </Repeat>
              </OTPInputGroup>
            </OTPInput>
            <FieldError role="alert">{codeError()}</FieldError>
          </Field>
          <Button
            type="submit"
            data-variant={code().length === CODE_LENGTH ? "solid" : undefined}
            disabled={pending() !== null}
          >
            <ArrowRight size={16} />
            {pending() === "join" ? "Checking room…" : "Join room"}
          </Button>
        </form>
        <p class="home-rules">
          New here?
          <RulesDialog
            targetScore={TARGET_SCORE}
            label="How to play"
            variant="quiet"
          />
        </p>
      </section>
    </main>
  );
}
