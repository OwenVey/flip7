const settle = async (update: Promise<void>) => {
  try {
    await update;
  } catch {
    // WARNING: the badge is a hint; a browser that refuses it (not installed, no permission) changes nothing.
  }
};

/**
 * Puts a dot on the installed app's icon. Browsers without the Badging API,
 * or a tab that isn't installed, ignore it.
 */
export const showAppBadge = () => {
  if ("setAppBadge" in navigator) {
    void settle(navigator.setAppBadge());
  }
};

/** Removes the dot `showAppBadge` put on the app icon. */
export const clearAppBadge = () => {
  if ("clearAppBadge" in navigator) {
    void settle(navigator.clearAppBadge());
  }
};
