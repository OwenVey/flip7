import { Title } from "@solidjs/meta";
import type { RouteDefinition } from "@solidjs/router";
import { httpStatus } from "@solidjs/web";

import PageMeta from "../components/page-meta";
import SiteNav from "../components/site-nav";

/**
 * The catch-all route. `httpStatus()` is a no-op in the browser and takes
 * effect when SSR is enabled; it runs in preload so the status code is set
 * before the response head flushes.
 */
export const route = {
  preload: () => {
    httpStatus(404);
  },
} satisfies RouteDefinition;

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main>
        <Title>Not Found · Hot Streak</Title>
        <PageMeta title="Not Found · Hot Streak" path="/" noindex />
        <h1>Page Not Found</h1>
        <p>
          <a href="/">Back to Hot Streak</a>
        </p>
      </main>
    </>
  );
}
