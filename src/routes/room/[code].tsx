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
  createMemo,
  createSignal,
  flush,
  Match,
  onSettled,
  Show,
  Switch,
  untrack,
} from "solid-js";

import JoinForm from "../../components/join-form";
import Lobby from "../../components/lobby";
import PageMeta from "../../components/page-meta";
import RoomConnecting from "../../components/room-connecting";
import RulesDialog from "../../components/rules-dialog";
import SiteNav from "../../components/site-nav";
import SoundControls from "../../components/sound-controls";
import Table from "../../components/table";
import { TARGET_SCORE } from "../../game/engine";
import { normalizeCode } from "../../game/protocol";
import { createDealMotion } from "../../lib/deal-motion";
import {
  createDealPlayback,
  initialDealPlayback,
} from "../../lib/deal-playback";
import { MOTION_PREFERENCE_QUERY } from "../../lib/motion";
import { createRoomConnection } from "../../lib/room-connection";
import { createRoomSounds } from "../../lib/room-sounds";
import {
  createTableOpening,
  nudge,
  revealOwnSeat,
} from "../../lib/table-motion";
import { paths } from "../../router";

const TURN_VIBRATION_MS = 200;

const Room = (props: { code: string }) => {
  const sounds = createRoomSounds();

  const connection = createRoomConnection(untrack(() => props.code));

  let roomPage: HTMLElement | undefined;
  let disposed = false;
  const [table, setTable] = createSignal(initialDealPlayback);

  const openTable = createTableOpening(() => roomPage);

  const playback = createDealPlayback(
    createDealMotion(() => roomPage),
    (view) => {
      setTable(view);
      flush();
      openTable(view.room?.phase ?? null);
    },
    (cue) => {
      sounds.play(cue);

      if (cue === "turn") {
        nudge(roomPage?.querySelector("[data-action-bar]") ?? null);
        revealOwnSeat(roomPage);

        if ("vibrate" in navigator) {
          navigator.vibrate(TURN_VIBRATION_MS);
        }
      }
    }
  );

  createEffect(
    () => {
      const status = connection.status();
      const playerId = connection.playerId();
      const room = connection.room();

      return room &&
        playerId !== null &&
        status !== "missing" &&
        status !== "removed"
        ? { canAct: connection.canAct(), playerId, room }
        : null;
    },
    (next) => {
      queueMicrotask(() => {
        if (!disposed) {
          playback.update(next);
        }
      });
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

        if (notice.confirmed === true) {
          toast.success(notice.message);
        } else {
          toast.error(notice.message);
          sounds.play("error", effectsEnabled);
        }
      }
    }
  );

  onSettled(() => {
    const motionPreference = globalThis.matchMedia?.(MOTION_PREFERENCE_QUERY);
    motionPreference?.addEventListener("change", playback.syncMotion);
    document.addEventListener("visibilitychange", playback.syncMotion);

    return () => {
      disposed = true;
      motionPreference?.removeEventListener("change", playback.syncMotion);
      document.removeEventListener("visibilitychange", playback.syncMotion);
      playback.dispose();
      toast.dismiss();
    };
  });

  const connectionProblem = () => {
    if (connection.room() === null) {
      return "";
    }

    if (!connection.online()) {
      return "You're offline. We'll reconnect when you're back online.";
    }

    if (connection.status() === "reconnecting") {
      return "Connection lost. Reconnecting…";
    }

    return "";
  };

  const seated = createMemo(
    () => {
      const { room } = table();
      const playerId = connection.playerId();

      return room && playerId !== null ? { playerId, room } : null;
    },
    {
      equals: (a, b) => a?.room === b?.room && a?.playerId === b?.playerId,
    }
  );

  return (
    <>
      <Title>
        {`${table().myMove ? "Your move · " : ""}Room ${props.code} · Hot Streak`}
      </Title>
      <PageMeta
        title={`Join room ${props.code} · Hot Streak`}
        description={`You're invited to a game of Hot Streak. Open the link to join room ${props.code}, pick a name and play. No accounts needed.`}
        path={paths.room(props.code)()}
        noindex
      />
      <SiteNav>
        <div class="room-nav-actions">
          <RulesDialog
            targetScore={connection.room()?.targetScore ?? TARGET_SCORE}
          />
          <SoundControls
            muted={sounds.muted()}
            effectsVolume={sounds.effectsVolume()}
            musicVolume={sounds.musicVolume()}
            onEffectsVolumeChange={sounds.changeEffectsVolume}
            onMusicVolumeChange={sounds.changeMusicVolume}
            onToggle={sounds.toggle}
          />
        </div>
      </SiteNav>
      <main
        class="room-page"
        ref={(element) => {
          roomPage = element;
        }}
      >
        <output class="connection-banner">{connectionProblem()}</output>
        <Switch
          fallback={
            <RoomConnecting
              code={props.code}
              online={connection.online()}
              onRetry={connection.retry}
            />
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
          <Match when={connection.needsName() && connection.room() !== null}>
            <JoinForm
              room={connection.room()}
              savedName={connection.savedName()}
              savedAvatar={connection.savedAvatar()}
              onJoin={connection.join}
              error={connection.joinError()}
              joining={connection.joining()}
              unavailable={
                !connection.online() || connection.status() !== "open"
              }
              onEdit={connection.clearJoinError}
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
                    chat={connection.chat}
                    actionsDisabled={table().actionsDisabled}
                    dealing={table().dealing}
                    dealStep={table().step}
                    incomingCardId={table().incomingCardId}
                  />
                }
              >
                <Lobby
                  room={view().room}
                  playerId={view().playerId}
                  send={connection.send}
                  actionsDisabled={
                    !connection.online() || connection.status() !== "open"
                  }
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
          <PageMeta
            title="Room not found · Hot Streak"
            path={paths()}
            noindex
          />
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
