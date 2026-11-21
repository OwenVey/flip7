import * as v from "valibot";

const IdSchema = v.pipe(v.string(), v.maxLength(64));

const RequestIdSchema = v.optional(v.pipe(v.string(), v.uuid()));

const ClientMessageSchema = v.variant("type", [
  v.object({
    name: v.pipe(v.string(), v.maxLength(200)),
    token: v.nullable(IdSchema),
    type: v.literal("join"),
  }),
  v.object({ requestId: RequestIdSchema, type: v.literal("start") }),
  v.object({ requestId: RequestIdSchema, type: v.literal("hit") }),
  v.object({ requestId: RequestIdSchema, type: v.literal("stay") }),
  v.object({
    requestId: RequestIdSchema,
    targetId: IdSchema,
    type: v.literal("choose"),
  }),
  v.object({ requestId: RequestIdSchema, type: v.literal("nextRound") }),
  v.object({ requestId: RequestIdSchema, type: v.literal("lobby") }),
  v.object({
    playerId: IdSchema,
    requestId: RequestIdSchema,
    type: v.literal("kick"),
  }),
  v.object({ requestId: RequestIdSchema, type: v.literal("leave") }),
]);

export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

export type GameCommand = Exclude<ClientMessage, { type: "join" }>;

const ClientMessageJsonSchema = v.pipe(
  v.string(),
  v.parseJson(),
  ClientMessageSchema
);

export const parseClientMessage = (raw: string) => {
  const result = v.safeParse(ClientMessageJsonSchema, raw);

  return result.success ? result.output : null;
};
