import type { ParentProps } from "solid-js";

import faviconUrl from "../assets/favicon.svg?url";
import { paths } from "../router";

export default function SiteNav(props: ParentProps) {
  return (
    <nav class="site-nav">
      <a href={paths()} class="nav-brand">
        <img src={faviconUrl} alt="" width={18} height={18} />
        Flip 7
      </a>
      {props.children}
    </nav>
  );
}
