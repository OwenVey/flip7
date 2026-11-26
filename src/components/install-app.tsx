import Download from "@lucide/solid/icons/download";
import Share from "@lucide/solid/icons/share";
import X from "@lucide/solid/icons/x";
import { Button } from "@ui-sdk/solid/button";
import { Match, Show, Switch } from "solid-js";

import { createInstallOffer } from "../lib/install-prompt";

/**
 * Offers to install Flip 7 on the home screen: the browser's install prompt
 * where it has one, or the Share steps on iOS. Hidden once installed or
 * dismissed.
 */
export default function InstallApp() {
  const { dismiss, install, offer } = createInstallOffer();

  return (
    <Show when={offer()}>
      {(kind) => (
        <aside class="home-install" aria-label="Install Flip 7">
          <Switch>
            <Match when={kind() === "prompt"}>
              <p class="home-install-text">
                Add Flip 7 to your home screen to open it like an app.
              </p>
              <Button
                data-size="sm"
                onClick={() => {
                  void install();
                }}
              >
                <Download size={14} aria-hidden="true" />
                Install
              </Button>
            </Match>
            <Match when={kind() === "ios"}>
              <p class="home-install-text">
                Install Flip 7: tap{" "}
                <Share
                  size={14}
                  aria-label="Share"
                  class="home-install-glyph"
                />{" "}
                then <strong>Add to Home Screen</strong>.
              </p>
            </Match>
          </Switch>
          <Button
            data-size="sm"
            data-icon=""
            aria-label="Don't show again"
            onClick={dismiss}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </aside>
      )}
    </Show>
  );
}
