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
import PageMeta from "../../components/page-meta";
import RoomConnecting from "../../components/room-connecting";
import RoomNotice from "../../components/room-notice";
import RulesDialog from "../../components/rules-dialog";
import SiteNav from "../../components/site-nav";
import SoundControls from "../../components/sound-controls";
import Table from "../../components/table";
import { createSheetTable } from "../../components/table-common";
import { normalizeCode } from "../../game/protocol";
import { DEFAULT_SETTINGS } from "../../game/settings";
import { createRoomChatLog } from "../../lib/room-chat-log";
import { createRoomConnection } from "../../lib/room-connection";
import { createRoomHaptics } from "../../lib/room-haptics";
import { createRoomSounds } from "../../lib/room-sounds";
import { createRoomTable, createRoomTablePage } from "../../lib/room-table";
import { resultsRound } from "../../lib/table-prompt";
import { createWakeLock } from "../../lib/wake-lock";
import { paths } from "../../router";

const Room = (props: { code: string }) => {
  const sounds = createRoomSounds();

  const connection = createRoomConnection(untrack(() => props.code));

  const haptics = createRoomHaptics(
    () =>
      connection.playerId() !== null &&
      connection.online() &&
      connection.status() === "open"
  );

  let roomPage: HTMLElement | undefined;

  const roomTable = createRoomTable({
    code: untrack(() => props.code),
    haptic: haptics.play,
    page: createRoomTablePage(() => roomPage),
    sound: sounds.play,
    source: connection,
  });

  const { view: table } = roomTable;

  createWakeLock(() => {
    const phase = connection.room()?.phase;
    const atTable = connection.playerId() !== null || connection.watching();

    return atTable && (phase === "playing" || phase === "roundOver");
  });

  const toast = createToaster();

  const unavailable = () =>
    !connection.online() || connection.status() !== "open";

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
          haptics.play("error");
        }
      }
    }
  );

  onSettled(() => () => {
    toast.dismiss();
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

  return (
    <>
      <Title>{roomTable.title()}</Title>
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
            hapticsEnabled={haptics.supported() ? haptics.enabled() : undefined}
            onHapticsChange={haptics.setEnabled}
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
          <Match when={roomTable.shown()}>
            {(view) => {
              const chatLog = createRoomChatLog({
                chat: connection.chat,
                inSheet: createSheetTable(),
                log: () => view().room.log,
                reactions: () => connection.room()?.reactions ?? {},
                playerId: () => view().playerId,
                players: () => view().room.players,
                resultsRound: () => resultsRound(view().room, table()),
                round: () => view().room.round,
                typing: connection.typing,
              });

              return (
                <Show
                  when={view().room.phase === "lobby"}
                  fallback={
                    <Table
                      room={view().room}
                      playerId={view().playerId}
                      send={connection.send}
                      chatLog={chatLog}
                      actionsDisabled={table().actionsDisabled}
                      offline={unavailable()}
                      latestRoom={connection.room()}
                      playback={table()}
                      spectator={spectator()}
                    />
                  }
                >
                  <Lobby
                    room={view().room}
                    playerId={view().playerId}
                    send={connection.send}
                    chatLog={chatLog}
                    actionsDisabled={unavailable()}
                    spectator={spectator()}
                    onWatchInstead={connection.watchInstead}
                    watchInsteadPending={connection.watchPending()}
                  />
                </Show>
              );
            }}
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
