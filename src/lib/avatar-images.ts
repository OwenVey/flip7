const files = import.meta.glob<string>("../assets/avatars/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});

const images = new Map(
  Object.entries(files).map(([path, src]) => [
    Number(/(?<avatar>\d+)\.svg$/u.exec(path)?.groups?.avatar),
    src,
  ])
);

/** The static asset URL for an avatar. */
export const avatarImage = (avatar: number) => images.get(avatar) ?? "";
