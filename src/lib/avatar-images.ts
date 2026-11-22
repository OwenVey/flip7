const files = import.meta.glob<string>("../assets/avatars/*.svg", {
  eager: true,
  import: "default",
  query: "?inline",
});

const images = new Map(
  Object.entries(files).map(([path, src]) => [
    Number(/(?<avatar>\d+)\.svg$/u.exec(path)?.groups?.avatar),
    src,
  ])
);

/** The image for an avatar. Vite inlines each small SVG into the bundle. */
export const avatarImage = (avatar: number) => images.get(avatar) ?? "";
