import Flame from "@lucide/solid/icons/flame";
import type { ParentProps } from "solid-js";

import { paths } from "../router";

export default function SiteNav(props: ParentProps) {
  return (
    <nav class="site-nav">
      <a href={paths()} class="nav-brand">
        <Flame size={18} />
        Hot Streak
      </a>
      {props.children}
    </nav>
  );
}
