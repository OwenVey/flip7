import WifiOff from "@lucide/solid/icons/wifi-off";

/** `compact` shows only the icon, for a row that already carries another badge. */
export default function OfflineBadge(props: { compact?: boolean }) {
  return (
    <span
      class="badge"
      data-tone="danger"
      title={props.compact === true ? "Offline" : undefined}
    >
      <WifiOff size={12} aria-hidden="true" />
      <span class={props.compact === true ? "sr-only" : undefined}>
        Offline
      </span>
    </span>
  );
}
