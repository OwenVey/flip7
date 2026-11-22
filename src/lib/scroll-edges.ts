const EDGE_TOLERANCE_PX = 1;

export const observeScrollEdges = (
  scroller: HTMLElement,
  content: Element,
  onResize?: () => void,
  horizontal = false
) => {
  const update = () => {
    const offset = horizontal
      ? Math.abs(scroller.scrollLeft)
      : scroller.scrollTop;

    const available = horizontal
      ? scroller.scrollWidth - scroller.clientWidth
      : scroller.scrollHeight - scroller.clientHeight;

    scroller.toggleAttribute("data-scroll-before", offset > EDGE_TOLERANCE_PX);
    scroller.toggleAttribute(
      "data-scroll-after",
      available - offset > EDGE_TOLERANCE_PX
    );
  };

  update();
  scroller.addEventListener("scroll", update, { passive: true });

  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          onResize?.();
          update();
        });

  observer?.observe(scroller);
  observer?.observe(content);

  return () => {
    observer?.disconnect();
    scroller.removeEventListener("scroll", update);
  };
};
