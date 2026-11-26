import { HydrationScript } from "@solidjs/web";
import { preloads } from "fontless/runtime";
import { For } from "solid-js";
import type { ParentProps } from "solid-js";
import { pwaAssetsHead } from "virtual:pwa-assets/head";

import faviconUrl from "./assets/favicon.svg?url";

// WARNING: the generator links a /favicon.svg that is never emitted; faviconUrl is the real one.
const GENERATED_LINKS = pwaAssetsHead.links.filter(
  (link) => link.type !== "image/svg+xml"
);

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#0e3a2c" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Flip 7" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <For each={GENERATED_LINKS}>
          {(link) => (
            <link
              rel={link.rel}
              href={link.href}
              media={link.media}
              sizes={link.sizes}
              type={link.type}
            />
          )}
        </For>
        <link rel="icon" type="image/svg+xml" href={faviconUrl} />
        <link rel="manifest" href="/site.webmanifest" />
        {preloads.map((attributes) => (
          <link
            rel={attributes.rel}
            href={attributes.href}
            as={attributes.as}
            type="font/woff2"
            crossorigin={attributes.crossorigin}
          />
        ))}
        <title>Flip 7</title>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
