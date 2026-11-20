import { Title } from "@solidjs/meta";
import type { RouteProps } from "@solidjs/router";
import {
  createToaster,
  Toast,
  ToastRegion,
  ToastTitle,
} from "@ui-sdk/solid/toast";
import {
  createEffect,
  Match,
  onSettled,
  Show,
  Switch,
  untrack,
} from "solid-js";

import JoinForm from "../../components/join-form";
import Lobby from "../../components/lobby";
import SiteNav from "../../components/site-nav";
import SoundControls from "../../components/sound-controls";
import Table from "../../components/table";
import { normalizeCode } from "../../game/protocol";
import { createRoomConnection } from "../../lib/room-connection";
import { createRoomSounds, roomCues } from "../../lib/room-sounds";
import { paths } from "../../router";

const TURN_VIBRATION_MS = 200;

const Room = (props: { code: string }) => {
  const sounds = createRoomSounds();

  const connection = createRoomConnection(
    untrack(() => props.code),
    (previous, current, playerId) => {
      for (const cue of roomCues(previous, current, playerId)) {
        sounds.play(cue);
      }
    }
  );

  const toast = createToaster();

  createEffect(
    () =>
      [
        connection.playerId() !== null,
        sounds.musicVolume(),
        sounds.muted(),
      ] as const,
    ([seated, volume, muted]) => {
      sounds.setSeated(seated, volume, muted);
    }
  );

  createEffect(
    () => {
      const notice = connection.notice();

      return notice && { notice, effectsEnabled: sounds.effectsEnabled() };
    },
    (current, previous) => {
      if (current && current.notice !== previous?.notice) {
        const { notice, effectsEnabled } = current;
        toast.error(notice.message);
        sounds.play("error", effectsEnabled);
      }
    }
  );

  onSettled(() => () => {
    toast.dismiss();
  });

  const connectionProblem = () => {
    if (!connection.online()) {
      return "You're offline. We'll reconnect when you're back online.";
    }

    if (connection.status() === "reconnecting") {
      return "Connection lost. Reconnecting…";
    }

    return "";
  };

  const seated = () => {
    const room = connection.room();
    const playerId = connection.playerId();

    return room && playerId !== null ? { playerId, room } : null;
  };

  const myMove = () => {
    const view = seated();

    if (view?.room.phase !== "playing") {
      return false;
    }

    const waitingOn = view.room.choice?.chooserId ?? view.room.turnId;

    return waitingOn === view.playerId;
  };

  createEffect(myMove, (mine) => {
    if (mine && "vibrate" in navigator) {
      navigator.vibrate(TURN_VIBRATION_MS);
    }
  });

  return (
    <>
      <Title>
        {`${myMove() ? "Your move · " : ""}Room ${props.code} · Hot Streak`}
      </Title>
      <SiteNav>
        <SoundControls
          muted={sounds.muted()}
          effectsVolume={sounds.effectsVolume()}
          musicVolume={sounds.musicVolume()}
          onEffectsVolumeChange={sounds.changeEffectsVolume}
          onMusicVolumeChange={sounds.changeMusicVolume}
          onToggle={sounds.toggle}
        />
      </SiteNav>
      <main class="room-page">
        <output class="connection-banner">{connectionProblem()}</output>
        <Switch
          fallback={
            <output class="status-message">
              Connecting to room {props.code}…
            </output>
          }
        >
          <Match when={connection.status() === "missing"}>
            <section class="panel">
              <h1>Room {props.code} doesn't exist</h1>
              <p class="muted">
                Check the code, or start a new room from the home page.
              </p>
              <a class="link" href={paths()}>
                Back to home
              </a>
            </section>
          </Match>
          <Match when={connection.status() === "removed"}>
            <section class="panel">
              <h1>You're out of room {props.code}</h1>
              <p class="muted">You left, or the host removed you.</p>
              <a class="link" href={paths()}>
                Back to home
              </a>
            </section>
          </Match>
          <Match when={connection.needsName()}>
            <JoinForm
              room={connection.room()}
              savedName={connection.savedName()}
              onJoin={connection.join}
            />
          </Match>
          <Match when={seated()}>
            {(view) => (
              <Show
                when={view().room.phase === "lobby"}
                fallback={
                  <Table
                    room={view().room}
                    playerId={view().playerId}
                    send={connection.send}
                  />
                }
              >
                <Lobby
                  room={view().room}
                  playerId={view().playerId}
                  send={connection.send}
                />
              </Show>
            )}
          </Match>
        </Switch>
        <ToastRegion toaster={toast} data-agent-hidden>
          {() => (
            <Toast>
              <ToastTitle />
            </Toast>
          )}
        </ToastRegion>
      </main>
    </>
  );
};

export default function RoomPage(props: RouteProps<"/room/:code">) {
  return (
    <Show
      when={normalizeCode(props.params.code ?? "")}
      keyed
      fallback={
        <>
          <SiteNav />
          <main class="room-page">
            <section class="panel">
              <h1>That isn't a room code</h1>
              <a class="link" href={paths()}>
                Back to home
              </a>
            </section>
          </main>
        </>
      }
    >
      {(code) => <Room code={code} />}
    </Show>
  );
}
