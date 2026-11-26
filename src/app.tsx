import { Title } from "@solidjs/meta";
import { Loading, onSettled } from "solid-js";

import { listenForInstallPrompt } from "./lib/install-prompt";
import { Router } from "./router";

import "@ui-sdk/core/web.css";
import "./app.css";
import "./styles/index.css";

export default function App() {
  onSettled(() => {
    listenForInstallPrompt();

    if (import.meta.env.PROD) {
      void import("virtual:pwa-register").then(({ registerSW }) =>
        registerSW({ immediate: true })
      );
    }
  });

  return (
    <Router>
      {(props) => (
        <>
          <Title>Flip 7</Title>
          <Loading fallback={<main>Loading…</main>}>{props.children}</Loading>
        </>
      )}
    </Router>
  );
}
