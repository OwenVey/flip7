import { HydrationScript } from "@solidjs/web";
import { preloads } from "fontless/runtime";
import type { ParentProps } from "solid-js";

import faviconUrl from "./assets/favicon.svg?url";

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
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href={faviconUrl} />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
