import { cleanup, render, screen } from "@solidjs/testing-library";
import { createAgent } from "@ui-sdk/solid/agent";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRoomHaptics } from "../lib/room-haptics";
import SoundControls from "./sound-controls";

const agent = createAgent();

const ControlsWithHaptics = () => {
  const haptics = createRoomHaptics(() => true);

  return (
    <SoundControls
      muted={false}
      effectsVolume={100}
      musicVolume={25}
      hapticsEnabled={haptics.supported() ? haptics.enabled() : undefined}
      onEffectsVolumeChange={() => {}}
      onMusicVolumeChange={() => {}}
      onToggle={() => {}}
      onHapticsChange={haptics.setEnabled}
    />
  );
};

describe(SoundControls, () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem("flip7:haptics-enabled");
    Reflect.deleteProperty(navigator, "vibrate");
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- Restores jsdom's missing media queries.
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("lets an agent open audio settings and adjust the two volumes independently", async () => {
    render(() => {
      const [muted, setMuted] = createSignal(false);
      const [music, setMusic] = createSignal(25);
      const [effects, setEffects] = createSignal(100);

      return (
        <SoundControls
          muted={muted()}
          effectsVolume={effects()}
          musicVolume={music()}
          onEffectsVolumeChange={(value) => {
            setEffects(value);
          }}
          onMusicVolumeChange={(value) => {
            setMusic(value);
          }}
          onToggle={() => {
            setMuted((value) => !value);
          }}
        />
      );
    });

    const trigger = screen.getByRole("button", { name: "Audio settings" });
    expect(trigger.querySelector("svg.lucide-volume-2")).toBeInTheDocument();

    const result = await agent.act({
      steps: [
        { action: "press", ref: "Audio settings" },
        { action: "setValue", args: [35], ref: "Music volume" },
        { action: "setValue", args: [60], ref: "Sound effects volume" },
        { action: "press", ref: "Mute all" },
      ],
    });

    flush();
    expect(result.error).toBeUndefined();
    expect(screen.getByRole("slider", { name: "Music volume" })).toHaveValue(
      "35"
    );
    expect(
      screen.getByRole("slider", { name: "Sound effects volume" })
    ).toHaveValue("60");
    expect(trigger.querySelector("svg.lucide-volume-x")).toBeInTheDocument();
  });

  it("remembers the haptics switch across visits independently of sound", async () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom has no vibration motor or API.
    const vibrate = vi.fn<(pattern: number | number[]) => boolean>();
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom has no media queries, so report a touch screen.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });

    const visit = render(() => <ControlsWithHaptics />);
    flush();

    const result = await agent.act({
      steps: [
        { action: "press", ref: "Audio and haptics" },
        { action: "setChecked", args: [false], ref: "Gameplay haptics" },
      ],
    });

    flush();
    expect(result.error).toBeUndefined();
    expect(vibrate).toHaveBeenCalledWith(0);
    visit.unmount();

    render(() => <ControlsWithHaptics />);
    flush();

    const reopened = await agent.act({
      steps: [{ action: "press", ref: "Audio and haptics" }],
    });

    expect(reopened.error).toBeUndefined();
    expect(
      screen.getByRole("switch", { name: "Gameplay haptics" })
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Mute all" })
    ).toBeInTheDocument();
  });
});
