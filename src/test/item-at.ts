/** The item at `index`, failing the test when there is none. */
export const itemAt = <T>(items: readonly T[], index: number) => {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`Expected an item at index ${index} of ${items.length}.`);
  }

  return item;
};
