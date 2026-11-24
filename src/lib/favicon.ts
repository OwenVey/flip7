const PLAIN_ICON = "/favicon.svg";
const DOT_ICON = "/favicon-dot.svg";

/** Shows or hides the move alert dot on the tab's icon. */
export const showFaviconDot = (dot: boolean) => {
  const icon = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]'
  );

  const href = dot ? DOT_ICON : PLAIN_ICON;

  if (icon && icon.getAttribute("href") !== href) {
    icon.setAttribute("href", href);
  }
};
