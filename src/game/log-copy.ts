/** A player as the log names them, with their name at the time. */
export interface LogPlayer {
  id: string;
  name: string;
}

export interface LogMention extends LogPlayer {
  offset: number;
}

export interface LogCopy {
  text: string;
  about: LogMention[];
}

export const logCopy = (
  strings: TemplateStringsArray,
  ...values: (LogPlayer | string | number)[]
) => {
  const about: LogMention[] = [];
  let text = strings[0] ?? "";

  for (const [index, value] of values.entries()) {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Only player interpolations create mentions.
    if (typeof value === "object") {
      about.push({ id: value.id, name: value.name, offset: text.length });
      text += value.name;
    } else {
      text += value;
    }

    text += strings[index + 1] ?? "";
  }

  return { about, text } satisfies LogCopy;
};
