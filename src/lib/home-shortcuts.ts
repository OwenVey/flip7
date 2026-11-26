/** The `?action=` values the manifest's home screen shortcuts open the home page with. */
export const SHORTCUT_ACTIONS = { create: "create", join: "join" } as const;

/** The home page URL a home screen shortcut opens. */
export const shortcutUrl = (action: keyof typeof SHORTCUT_ACTIONS) =>
  `/?action=${SHORTCUT_ACTIONS[action]}`;
