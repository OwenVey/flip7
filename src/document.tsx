import bigShouldersUrl from "@fontsource-variable/big-shoulders-display/files/big-shoulders-display-latin-wght-normal.woff2?url";
import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import bungeeUrl from "@fontsource/bungee/files/bungee-latin-400-normal.woff2?url";
import { HydrationScript } from "@solidjs/web";
import type { ParentProps } from "solid-js";

// WARNING: these must be the same files the @font-face rules in app.css load, or they download twice.
const preloadedFonts = [interUrl, bungeeUrl, bigShouldersUrl];

export default function Document(props: ParentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#0e3a2c" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        {preloadedFonts.map((href) => (
          <link
            rel="preload"
            href={href}
            as="font"
            type="font/woff2"
            crossorigin=""
          />
        ))}
        <title>Hot Streak</title>
        <HydrationScript />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
