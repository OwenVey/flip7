import { createEffect, createMemo, createSignal, onSettled } from "solid-js";

import plainSvg from "../assets/favicon.svg?raw";
import siteIcon from "../assets/favicon.svg?url";

const MOVE_ALERT_TITLE = "⚡ Your move!";
const MOVE_ALERT_BLINK_MS = 1000;
const SITE_ICON = siteIcon;

const DOT =
  '<circle cx="49" cy="15" r="13" fill="#e5322d" stroke="#fcf5e8" stroke-width="4"/>';

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const PLAIN_FRAME = svgUrl(plainSvg);
const DOT_FRAME = svgUrl(plainSvg.replace("</svg>", `${DOT}</svg>`));

type Blink = "off" | "steady" | "lit" | "dark";

const ICONS = {
  dark: PLAIN_FRAME,
  lit: DOT_FRAME,
  off: SITE_ICON,
  steady: DOT_FRAME,
} satisfies Record<Blink, string>;

const setSvgIcon = (href: string) => {
  const icon = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]'
  );

  if (icon && icon.getAttribute("href") !== href) {
    icon.setAttribute("href", href);
  }
};

const createTabHidden = () => {
  const [hidden, setHidden] = createSignal(false);

  const sync = () => {
    setHidden(document.visibilityState === "hidden");
  };

  onSettled(() => {
    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  });

  return hidden;
};

/**
 * Shows the move alert on the browser tab and returns the page title to use.
 * While the game waits on the player the tab icon gets a dot. In a hidden tab
 * the title and dot blink so the tab stands out in a crowded tab strip.
 */
export const createMoveAlert = (
  alerting: () => boolean,
  title: () => string,
  tabHidden = createTabHidden()
) => {
  const [lit, setLit] = createSignal(true, { ownedWrite: true });
  const blinking = createMemo(() => alerting() && tabHidden());

  const startBlinking = () => {
    const timer = setInterval(() => {
      setLit((current) => !current);
    }, MOVE_ALERT_BLINK_MS);

    return () => {
      clearInterval(timer);
    };
  };

  createEffect(blinking, (on) => {
    setLit(true);

    return on ? startBlinking() : undefined;
  });

  const blink = createMemo(() => {
    let state: Blink = "off";

    if (blinking()) {
      state = lit() ? "lit" : "dark";
    } else if (alerting()) {
      state = "steady";
    }

    return state;
  });

  createEffect(() => ICONS[blink()], setSvgIcon);

  onSettled(() => () => {
    setSvgIcon(SITE_ICON);
  });

  return () => (blink() === "lit" ? MOVE_ALERT_TITLE : title());
};
