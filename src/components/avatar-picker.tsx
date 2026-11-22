import { Field } from "@ui-sdk/solid/field";
import {
  createPopoverController,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/solid/popover";
import { Radio, RadioGroup } from "@ui-sdk/solid/radio";
import { createSignal, createUniqueId, For } from "solid-js";

import { AVATARS } from "../game/avatars";
import AvatarImage from "./avatar-image";

const AVATAR_DESCRIPTIONS = [
  "Pink circle on yellow",
  "Green egg on yellow",
  "Blue square on yellow",
  "Cream arch on yellow",
  "Pink pentagon on yellow",
  "Green pill on red",
  "Blue hexagon on red",
  "Cream column on red",
  "Yellow circle on red",
  "Green square on red",
  "Blue octagon on green",
  "Cream pentagon on green",
  "Yellow arch on green",
  "Pink pill on green",
  "Blue column on green",
  "Cream circle on blue",
  "Yellow egg on blue",
  "Pink square on blue",
  "Green pill on blue",
  "Cream pentagon on blue",
  "Cream pill on purple",
  "Yellow hexagon on purple",
  "Pink square on purple",
  "Green circle on purple",
  "Blue egg on purple",
];

export default function AvatarPicker(props: {
  anchor?: HTMLElement;
  value: number;
  onChange: (avatar: number) => void;
  disabled?: boolean;
}) {
  const picker = createPopoverController();
  const [draft, setDraft] = createSignal<number>();
  const titleId = createUniqueId();
  const choice = () => draft() ?? props.value;
  let trigger: HTMLElement | undefined;

  const confirm = (avatar: number, event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    props.onChange(avatar);
    picker.close({ event, reason: "close-press" });
  };

  return (
    <Popover
      controller={picker}
      onOpenChange={(next) => {
        if (next) {
          setDraft(props.value);
        }
      }}
    >
      <PopoverTrigger
        ref={(element) => {
          trigger = element;
        }}
        class="avatar-trigger"
        data-icon=""
        aria-label="Change avatar"
        disabled={props.disabled}
      >
        <AvatarImage avatar={props.value} />
      </PopoverTrigger>
      <PopoverContent
        class="avatar-picker"
        anchor={props.anchor}
        side="bottom"
        align="start"
        sideOffset={4}
        finalFocus={() => trigger ?? null}
      >
        <PopoverTitle>
          <span id={titleId}>Choose an avatar</span>
        </PopoverTitle>
        <Field>
          <RadioGroup
            class="avatar-grid"
            aria-labelledby={titleId}
            value={String(choice())}
            onValueChange={(next) => {
              if (next !== null) {
                setDraft(Number(next));
              }
            }}
          >
            <For each={AVATARS}>
              {(avatar) => (
                <Radio
                  class="avatar-option"
                  value={String(avatar)}
                  aria-label={AVATAR_DESCRIPTIONS[avatar - 1]}
                  onClick={(event) => {
                    confirm(avatar, event);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      confirm(avatar, event);
                    }
                  }}
                >
                  <AvatarImage avatar={avatar} />
                </Radio>
              )}
            </For>
          </RadioGroup>
        </Field>
      </PopoverContent>
    </Popover>
  );
}
