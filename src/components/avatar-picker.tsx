import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import { Radio, RadioGroup } from "@ui-sdk/solid/radio";
import { createSignal, For } from "solid-js";

import { AVATARS } from "../game/avatars";
import AvatarImage from "./avatar-image";

export default function AvatarPicker(props: {
  value: number;
  onChange: (avatar: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <PopoverTrigger
        class="avatar-trigger"
        data-icon=""
        aria-label="Change avatar"
        disabled={props.disabled}
      >
        <AvatarImage avatar={props.value} />
      </PopoverTrigger>
      <PopoverContent class="avatar-picker" side="bottom" align="start">
        <PopoverTitle>Choose an avatar</PopoverTitle>
        <RadioGroup
          class="avatar-grid"
          aria-label="Avatar"
          value={String(props.value)}
          onValueChange={(next, details) => {
            if (next === null) {
              return;
            }

            props.onChange(Number(next));

            const confirmedByPress = details.reason === "item-press";

            if (confirmedByPress) {
              setOpen(false);
            }
          }}
        >
          <For each={AVATARS}>
            {(avatar) => (
              <Radio
                class="avatar-option"
                value={String(avatar)}
                aria-label={`Avatar ${avatar}`}
              >
                <AvatarImage avatar={avatar} />
              </Radio>
            )}
          </For>
        </RadioGroup>
      </PopoverContent>
    </Popover>
  );
}
