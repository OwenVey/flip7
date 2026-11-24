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
import RoomNotice from "../../components/room-notice";
import RulesDialog from "../../components/rules-dialog";
import SiteNav from "../../components/site-nav";
import SoundControls from "../../components/sound-controls";
import Table from "../../components/table";
import { normalizeCode } from "../../game/protocol";
import { DEFAULT_SETTINGS } from "../../game/settings";
import { createDealMotion } from "../../lib/deal-motion";
import {
  createDealPlayback,
  initialDealPlayback,
} from "../../lib/deal-playback";
import { MOTION_PREFERENCE_QUERY } from "../../lib/motion";
import { createMoveAlert } from "../../lib/move-alert";
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
        (playerId !== null || connection.watching()) &&
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

  const unavailable = () =>
    !connection.online() || connection.status() !== "open";

  const titlePrefix = () => {
    if (table().myMove) {
      return "Your move · ";
    }

    return connection.watching() ? "Watching · " : "";
  };

  const pageTitle = createMoveAlert(
    () => table().myMove,
    () => `${titlePrefix()}Room ${props.code} · Flip 7`
  );

  const spectator = () => ({
    join: {
      error: connection.joinError(),
      joining: connection.joining(),
      onEdit: connection.clearJoinError,
      onJoin: connection.join,
      savedAvatar: connection.savedAvatar(),
      savedName: connection.savedName(),
      unavailable: unavailable(),
    },
    onLeave: connection.stopWatching,
  });

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

  const tableView = createMemo(
    () => {
      const { room } = table();
      const playerId = connection.playerId();

      return room && (playerId !== null || connection.watching())
        ? { playerId, room }
        : null;
    },
    {
      equals: (a, b) => a?.room === b?.room && a?.playerId === b?.playerId,
    }
  );

  return (
    <>
      <Title>{pageTitle()}</Title>
      <PageMeta
        title={`Join room ${props.code} · Flip 7`}
        description={`You're invited to a game of Flip 7. Open the link to join room ${props.code}, pick a name and play. No accounts needed.`}
        path={paths.room(props.code)()}
        noindex
      />
      <SiteNav>
        <div class="room-nav-actions">
          <RulesDialog
            targetScore={
              connection.room()?.settings.targetScore ??
              DEFAULT_SETTINGS.targetScore
            }
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
            <RoomNotice title="No table here" code={props.code} card="empty">
              Check the code and try again.
            </RoomNotice>
          </Match>
          <Match when={connection.status() === "removed"}>
            <RoomNotice
              title="Out of the room"
              code={props.code}
              card="deck"
              onReturn={connection.returnToRoom}
            >
              You left, or the host removed you.
            </RoomNotice>
          </Match>
          <Match when={connection.needsName() && connection.preview()}>
            {(preview) => (
              <JoinForm
                room={preview()}
                locked={preview().locked}
                onWatch={connection.watch}
                watchError={connection.watchError()}
                watchPending={connection.watchPending()}
                savedName={connection.savedName()}
                savedAvatar={connection.savedAvatar()}
                onJoin={connection.join}
                error={connection.joinError()}
                joining={connection.joining()}
                unavailable={unavailable()}
                onEdit={connection.clearJoinError}
              />
            )}
          </Match>
          <Match when={tableView()}>
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
                    offline={unavailable()}
                    latestRoom={connection.room()}
                    dealing={table().dealing}
                    dealStep={table().step}
                    roundPoints={table().roundPoints}
                    spectator={spectator()}
                  />
                }
              >
                <Lobby
                  room={view().room}
                  playerId={view().playerId}
                  send={connection.send}
                  chat={connection.chat}
                  actionsDisabled={unavailable()}
                  spectator={spectator()}
                  onWatchInstead={connection.watchInstead}
                  watchInsteadPending={connection.watchPending()}
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
          <PageMeta title="Room not found · Flip 7" path={paths()} noindex />
          <SiteNav />
          <main class="room-page">
            <RoomNotice title="Not a room code" card="empty">
              Room codes are five letters.
            </RoomNotice>
          </main>
        </>
      }
    >
      {(code) => <Room code={code} />}
    </Show>
  );
}
