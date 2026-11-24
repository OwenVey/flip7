import dotSvg from "../../public/favicon-dot.svg?raw";
import plainSvg from "../../public/favicon.svg?raw";

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const PLAIN_ICON = svgUrl(plainSvg);
const DOT_ICON = svgUrl(dotSvg);

/** Shows or hides the move alert dot using embedded frames for prompt redraws. */
export const showFaviconDot = (dot: boolean) => {
  const icon = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]'
  );

  const href = dot ? DOT_ICON : PLAIN_ICON;

  if (icon && icon.getAttribute("href") !== href) {
    icon.setAttribute("href", href);
  }
};
