import { Link, Meta } from "@solidjs/meta";
import { Show } from "solid-js";

export const SITE_NAME = "Flip 7";

export const SITE_ORIGIN = "https://flip7.owenvey.com";

export const SITE_DESCRIPTION =
  "Flip 7 is a multiplayer push-your-luck card game for 2 to 16 players. Hit or Stay, dodge duplicates, and earn a bonus for seven unique numbers. Play in your browser with a room code and no account.";

const OG_IMAGE = {
  alt: "Flip 7 wordmark beside a fan of playing cards on green felt",
  height: "630",
  path: "/og-image.jpg",
  type: "image/jpeg",
  width: "1200",
} as const;

/**
 * Search and link-preview metadata for one page. Tags deduplicate by name, so
 * a page's tags replace the defaults set higher up the tree.
 */
export default function PageMeta(props: {
  title: string;
  description?: string;
  /** The page's path, used for its canonical and share URL. */
  path: string;
  /** Keep the page out of search results (it still gets link previews). */
  noindex?: boolean;
}) {
  const url = () => `${SITE_ORIGIN}${props.path}`;
  const description = () => props.description ?? SITE_DESCRIPTION;

  return (
    <>
      <Meta name="description" content={description()} />
      <Meta
        name="robots"
        content={props.noindex === true ? "noindex, follow" : "index, follow"}
      />
      <Show when={props.noindex !== true}>
        <Link rel="canonical" href={url()} />
      </Show>

      <Meta property="og:site_name" content={SITE_NAME} />
      <Meta property="og:type" content="website" />
      <Meta property="og:locale" content="en_US" />
      <Meta property="og:title" content={props.title} />
      <Meta property="og:description" content={description()} />
      <Meta property="og:url" content={url()} />
      <Meta property="og:image" content={`${SITE_ORIGIN}${OG_IMAGE.path}`} />
      <Meta property="og:image:type" content={OG_IMAGE.type} />
      <Meta property="og:image:width" content={OG_IMAGE.width} />
      <Meta property="og:image:height" content={OG_IMAGE.height} />
      <Meta property="og:image:alt" content={OG_IMAGE.alt} />

      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={props.title} />
      <Meta name="twitter:description" content={description()} />
      <Meta name="twitter:image" content={`${SITE_ORIGIN}${OG_IMAGE.path}`} />
      <Meta name="twitter:image:alt" content={OG_IMAGE.alt} />
    </>
  );
}
