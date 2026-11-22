import WifiOff from "@lucide/solid/icons/wifi-off";

export default function OfflineBadge() {
  return (
    <span class="badge" data-tone="danger">
      <WifiOff size={12} aria-hidden="true" />
      Offline
    </span>
  );
}
