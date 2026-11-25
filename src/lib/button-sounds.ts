const SOUNDING_CONTROL = [
  "button",
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="tab"]',
].join(", ");

const INACTIVE_CONTROL = ':disabled, [aria-disabled="true"]';

/** The sounds a button makes as it goes down and comes back up. */
export type ButtonCue = "press" | "release";

const isActivationKey = (event: KeyboardEvent) =>
  event.key === "Enter" || event.key === " ";

/** The enabled button-like control an event happened on, if any. */
export const soundingControl = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return null;
  }

  const control = target.closest(SOUNDING_CONTROL);

  return control && !control.matches(INACTIVE_CONTROL) ? control : null;
};

/**
 * Plays a press sound when a control goes down, by pointer or by Enter or
 * Space, and a release sound when that same control comes back up.
 */
export const listenForButtonSounds = (
  root: Document,
  play: (cue: ButtonCue) => void
) => {
  let pressed: Element | null = null;

  const press = (control: Element | null) => {
    pressed = control;

    if (control) {
      play("press");
    }
  };

  const pointerDown = (event: PointerEvent) => {
    press(event.button === 0 ? soundingControl(event.target) : null);
  };

  const pointerUp = (event: PointerEvent) => {
    const control = pressed;
    pressed = null;

    if (control && soundingControl(event.target) === control) {
      play("release");
    }
  };

  const cancel = () => {
    pressed = null;
  };

  const keyDown = (event: KeyboardEvent) => {
    if (isActivationKey(event) && !event.repeat) {
      press(soundingControl(event.target));
    }
  };

  const keyUp = (event: KeyboardEvent) => {
    if (isActivationKey(event) && pressed) {
      pressed = null;
      play("release");
    }
  };

  root.addEventListener("pointerdown", pointerDown, true);
  root.addEventListener("pointerup", pointerUp, true);
  root.addEventListener("pointercancel", cancel, true);
  root.addEventListener("keydown", keyDown, true);
  root.addEventListener("keyup", keyUp, true);

  return () => {
    root.removeEventListener("pointerdown", pointerDown, true);
    root.removeEventListener("pointerup", pointerUp, true);
    root.removeEventListener("pointercancel", cancel, true);
    root.removeEventListener("keydown", keyDown, true);
    root.removeEventListener("keyup", keyUp, true);
  };
};
