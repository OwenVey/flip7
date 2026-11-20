import * as v from "valibot";

const IdSchema = v.pipe(v.string(), v.maxLength(64));

const ClientMessageSchema = v.variant("type", [
  v.object({
    name: v.pipe(v.string(), v.maxLength(200)),
    token: v.nullable(IdSchema),
    type: v.literal("join"),
  }),
  v.object({ type: v.literal("start") }),
  v.object({ type: v.literal("hit") }),
  v.object({ type: v.literal("stay") }),
  v.object({ targetId: IdSchema, type: v.literal("choose") }),
  v.object({ type: v.literal("nextRound") }),
  v.object({ type: v.literal("lobby") }),
  v.object({ playerId: IdSchema, type: v.literal("kick") }),
  v.object({ type: v.literal("leave") }),
]);

export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

const ClientMessageJsonSchema = v.pipe(
  v.string(),
  v.parseJson(),
  ClientMessageSchema
);

export const parseClientMessage = (raw: string) => {
  const result = v.safeParse(ClientMessageJsonSchema, raw);

  return result.success ? result.output : null;
};
