import SlidersHorizontal from "@lucide/solid/icons/sliders-horizontal";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/solid/field";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import type { PopoverController } from "@ui-sdk/solid/popover";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/solid/segmented-control";
import { Switch, SwitchThumb } from "@ui-sdk/solid/switch";
import { For, Show } from "solid-js";

import type { RoomView } from "../game/protocol";
import { BOT_SPEEDS, TARGET_SCORES } from "../game/settings";
import type { BotSpeed, RoomSettings } from "../game/settings";
import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

const BOT_SPEED_LABELS: Record<BotSpeed, string> = {
  fast: "Fast",
  normal: "Normal",
};

const hasBots = (room: Pick<RoomView, "players">) =>
  room.players.some((player) => player.bot);

/** A one-line summary of the room's settings, for guests who can't change them. */
export const settingsSummary = (room: Pick<RoomView, "players" | "settings">) =>
  [
    `First to ${room.settings.targetScore}`,
    room.settings.botSpeed === "fast" && hasBots(room) ? "Fast bots" : null,
    room.settings.locked ? "Room locked" : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

/**
 * The host's settings. Each control shows the room's saved value, so a
 * change appears once the room confirms it.
 */
export default function RoomSettingsForm(props: {
  room: RoomView;
  readOnly?: boolean;
  /** Shows the winning score, which can only change between games. */
  targetScore?: boolean;
  onChange: (changes: Partial<RoomSettings>) => void;
}) {
  return (
    <div class="room-settings">
      <Show when={props.targetScore !== false}>
        <Field class="setting">
          <FieldLabel>Winning score</FieldLabel>
          <SegmentedControl
            value={String(props.room.settings.targetScore)}
            readOnly={props.readOnly}
            onValueChange={(next, details) => {
              details.cancel();

              const targetScore = TARGET_SCORES.find(
                (score) => String(score) === next
              );

              if (targetScore !== undefined) {
                props.onChange({ targetScore });
              }
            }}
          >
            <SegmentedControlIndicator />
            <For each={TARGET_SCORES}>
              {(score) => (
                <SegmentedControlItem value={String(score)}>
                  {score}
                </SegmentedControlItem>
              )}
            </For>
          </SegmentedControl>
        </Field>
      </Show>

      <Show when={hasBots(props.room)}>
        <Field class="setting">
          <FieldLabel>Bot speed</FieldLabel>
          <SegmentedControl
            value={props.room.settings.botSpeed}
            readOnly={props.readOnly}
            onValueChange={(next, details) => {
              details.cancel();
              const botSpeed = BOT_SPEEDS.find((speed) => speed === next);

              if (botSpeed !== undefined) {
                props.onChange({ botSpeed });
              }
            }}
          >
            <SegmentedControlIndicator />
            <For each={BOT_SPEEDS}>
              {(speed) => (
                <SegmentedControlItem value={speed}>
                  {BOT_SPEED_LABELS[speed]}
                </SegmentedControlItem>
              )}
            </For>
          </SegmentedControl>
        </Field>
      </Show>

      <Field class="setting">
        <div class="setting-copy">
          <FieldLabel>Lock room</FieldLabel>
          <FieldDescription>New players can't join.</FieldDescription>
        </div>
        <Switch
          checked={props.room.settings.locked}
          readOnly={props.readOnly}
          onCheckedChange={(next, details) => {
            details.cancel();
            props.onChange({ locked: next });
          }}
        >
          <SwitchThumb />
        </Switch>
      </Field>
    </div>
  );
}

/** The host's settings during a game, in a popover from the table header. */
export const RoomSettingsMenu = (props: {
  room: RoomView;
  /** Lets another control, like the table's phone menu, open the settings. */
  controller?: PopoverController;
  /** Hides the button on narrow screens, where the table's menu offers the settings instead. */
  collapsible?: boolean;
  onChange: (changes: Partial<RoomSettings>) => void;
}) => (
  <Popover controller={props.controller}>
    <Tooltip
      content="Room settings"
      type="label"
      compactOnly
      trigger={(hint) => (
        <PopoverTrigger
          {...hint}
          data-collapsible={props.collapsible === true ? "" : undefined}
        />
      )}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span class="button-label">Settings</span>
    </Tooltip>
    <PopoverContent class="room-settings-popover" side="bottom" align="end">
      <ScrollFade>
        <div class="room-settings-popover-body">
          <PopoverTitle>Room settings</PopoverTitle>
          <RoomSettingsForm
            room={props.room}
            targetScore={false}
            onChange={props.onChange}
          />
          <p class="room-settings-note">
            The winning score can change in the lobby.
          </p>
        </div>
      </ScrollFade>
    </PopoverContent>
  </Popover>
);
