import { cleanup, render, screen } from "@solidjs/testing-library";
import { createAgent } from "@ui-sdk/solid/agent";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import SoundControls from "./sound-controls";

const agent = createAgent();

describe(SoundControls, () => {
  afterEach(cleanup);

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
});
