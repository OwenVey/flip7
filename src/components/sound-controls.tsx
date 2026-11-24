import Volume2 from "@lucide/solid/icons/volume-2";
import VolumeX from "@lucide/solid/icons/volume-x";
import { Button } from "@ui-sdk/solid/button";
import { Field, FieldLabel } from "@ui-sdk/solid/field";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@ui-sdk/solid/slider";
import { Switch, SwitchThumb } from "@ui-sdk/solid/switch";
import { Show } from "solid-js";

import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

const VolumeControl = (props: {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
}) => (
  <Field>
    <Slider value={props.value} onValueChange={props.onValueChange}>
      <div class="volume-label">
        <FieldLabel>{props.label}</FieldLabel>
        <span aria-hidden="true">{props.value}%</span>
      </div>
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb />
        </SliderTrack>
      </SliderControl>
    </Slider>
  </Field>
);

export default function SoundControls(props: {
  muted: boolean;
  effectsVolume: number;
  musicVolume: number;
  onEffectsVolumeChange: (value: number) => void;
  onMusicVolumeChange: (value: number) => void;
  onToggle: () => void;
  hapticsEnabled?: boolean;
  onHapticsChange?: (enabled: boolean) => void;
}) {
  const title = () =>
    props.hapticsEnabled === undefined ? "Audio settings" : "Audio and haptics";

  const silent = () =>
    props.muted || (props.effectsVolume === 0 && props.musicVolume === 0);

  return (
    <Popover>
      <Tooltip
        content={title()}
        type="label"
        side="bottom"
        trigger={(hint) => (
          <PopoverTrigger {...hint} aria-label={title()} data-icon="" />
        )}
      >
        {silent() ? (
          <VolumeX size={18} aria-hidden="true" />
        ) : (
          <Volume2 size={18} aria-hidden="true" />
        )}
      </Tooltip>
      <PopoverContent class="audio-settings" side="bottom" align="end">
        <ScrollFade>
          <div class="audio-settings-body">
            <PopoverTitle>{title()}</PopoverTitle>
            <VolumeControl
              label="Music volume"
              value={props.musicVolume}
              onValueChange={props.onMusicVolumeChange}
            />
            <VolumeControl
              label="Sound effects volume"
              value={props.effectsVolume}
              onValueChange={props.onEffectsVolumeChange}
            />
            <Button data-size="sm" onClick={props.onToggle}>
              {props.muted ? "Unmute all" : "Mute all"}
            </Button>
            <Show when={props.hapticsEnabled !== undefined}>
              <Field class="haptics-setting">
                <FieldLabel>Gameplay haptics</FieldLabel>
                <Switch
                  checked={props.hapticsEnabled === true}
                  onCheckedChange={props.onHapticsChange}
                >
                  <SwitchThumb />
                </Switch>
              </Field>
            </Show>
          </div>
        </ScrollFade>
      </PopoverContent>
    </Popover>
  );
}
