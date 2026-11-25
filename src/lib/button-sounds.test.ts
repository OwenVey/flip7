import { afterEach, describe, expect, it } from "vitest";

import { listenForButtonSounds, soundingControl } from "./button-sounds";
import type { ButtonCue } from "./button-sounds";

const render = (html: string) => {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;

  if (!element) {
    throw new Error("Nothing rendered");
  }

  return element;
};

const pointer = (type: string, target: Element, button = 0) => {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, button, cancelable: true })
  );
};

const key = (type: string, target: Element, init: KeyboardEventInit) => {
  target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
};

const listen = () => {
  const cues: ButtonCue[] = [];

  const stop = listenForButtonSounds(document, (cue) => {
    cues.push(cue);
  });

  return { cues, stop };
};

describe(soundingControl, () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds the button around an icon and skips disabled controls", () => {
    const button = render("<button><svg></svg></button>");
    const icon = button.querySelector("svg");

    expect({
      disabled: soundingControl(render("<button disabled>Hit</button>")),
      icon: soundingControl(icon) === button,
      inactive: soundingControl(
        render('<button aria-disabled="true">Start</button>')
      ),
      text: soundingControl(render("<p>Score</p>")),
    }).toStrictEqual({
      disabled: null,
      icon: true,
      inactive: null,
      text: null,
    });
  });
});

describe(listenForButtonSounds, () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("presses on the way down and releases on the same button", () => {
    const { cues, stop } = listen();
    const button = render("<button>Hit</button>");

    pointer("pointerdown", button);
    pointer("pointerup", button);
    stop();

    expect(cues).toStrictEqual(["press", "release"]);
  });

  it("does not release when the pointer is cancelled or lifts elsewhere", () => {
    const { cues, stop } = listen();
    const button = render("<div><button>Hit</button><p>Felt</p></div>");
    const hit = button.querySelector("button");
    const felt = button.querySelector("p");

    if (!hit || !felt) {
      throw new Error("Missing table parts");
    }

    pointer("pointerdown", hit);
    pointer("pointercancel", hit);
    pointer("pointerup", hit);
    pointer("pointerdown", hit);
    pointer("pointerup", felt);
    pointer("pointerdown", hit, 2);
    stop();

    expect(cues).toStrictEqual(["press", "press"]);
  });

  it("plays for Enter and Space but not held-key repeats or other keys", () => {
    const { cues, stop } = listen();
    const button = render("<button>Stay</button>");

    key("keydown", button, { key: "Enter" });
    key("keydown", button, { key: "Enter", repeat: true });
    key("keyup", button, { key: "Enter" });
    key("keydown", button, { key: "a" });
    key("keyup", button, { key: "a" });
    key("keydown", button, { key: " " });
    key("keyup", button, { key: " " });
    stop();
    pointer("pointerdown", button);

    expect(cues).toStrictEqual(["press", "release", "press", "release"]);
  });
});
