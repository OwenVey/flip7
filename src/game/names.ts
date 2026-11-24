/**
 * The form two names are compared in, so names that look alike count as the
 * same: compatibility forms (fullwidth letters, ligatures, styled maths
 * letters) fold to plain ones and case is ignored.
 */
export const nameKey = (name: string) => name.normalize("NFKC").toLowerCase();

export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);
