import plainSvg from "../../public/favicon.svg?raw";

const SITE_ICON = "/favicon.svg";

const DOT =
  '<circle cx="49" cy="15" r="13" fill="#e5322d" stroke="#fcf5e8" stroke-width="4"/>';

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const PLAIN_FRAME = svgUrl(plainSvg);
const DOT_FRAME = svgUrl(plainSvg.replace("</svg>", `${DOT}</svg>`));

const setSvgIcon = (href: string) => {
  const icon = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]'
  );

  if (icon && icon.getAttribute("href") !== href) {
    icon.setAttribute("href", href);
  }
};

/** Shows or hides the move alert dot using embedded frames for prompt redraws. */
export const showFaviconDot = (dot: boolean) => {
  setSvgIcon(dot ? DOT_FRAME : PLAIN_FRAME);
};

/** Puts back the site's own icon link when the move alert is gone for good. */
export const restoreFavicon = () => {
  setSvgIcon(SITE_ICON);
};
