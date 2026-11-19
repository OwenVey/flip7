import { Title } from "@solidjs/meta";
import { query } from "@solidjs/router";
import type { RouteDefinition, RouteProps } from "@solidjs/router";
import { createMemo, isPending } from "solid-js";

import type users from "../../data/users.json";
import { paths } from "../../router";

type Users = typeof users;

const unknownUser = { name: "Unknown", title: "No such user" };

const isUserId = (all: Users, id: string): id is keyof Users =>
  Object.hasOwn(all, id);

const getUser = query(async (id: string) => {
  const { default: all } = await import("../../data/users.json");

  return isUserId(all, id) ? all[id] : unknownUser;
}, "user");

/** Starts the fetch as soon as navigation begins, before the page renders. */
export const route = {
  preload: async ({ params }) => {
    if (params.id !== undefined) {
      await getUser(params.id);
    }
  },
} satisfies RouteDefinition;

/**
 * Async data loading: a query (cached per key) read through a memo. The
 * surrounding `<Loading>` boundary in app.tsx shows its fallback until the
 * promise settles. The data is a lazily imported JSON module here; swap the
 * query body for any API call (an absolute URL, or a server function). Avoid
 * fetching your own origin during SSR: behind a proxy the incoming Host
 * header rarely routes back to this server.
 */
export default function User(props: RouteProps<"/users/:id">) {
  const user = createMemo(async () => await getUser(props.params.id));

  return (
    <section style={{ opacity: isPending(user) ? 0.5 : 1 }}>
      <Title>{`User ${props.params.id} - Solid App`}</Title>
      <h2>{user().name}</h2>
      <p>{user().title}</p>
      <p>
        <a href={paths.users(Number(props.params.id) + 1)}>Next user</a>
      </p>
    </section>
  );
}
