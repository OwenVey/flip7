import * as v from "valibot";

const IdSchema = v.pipe(v.string(), v.maxLength(64));

const RequestIdSchema = v.optional(v.pipe(v.string(), v.uuid()));

const ForIdSchema = v.optional(IdSchema);

const ClientMessageSchema = v.variant("type", [
  v.object({
    name: v.pipe(v.string(), v.maxLength(200)),
    token: v.nullable(IdSchema),
    type: v.literal("join"),
  }),
  v.object({ requestId: RequestIdSchema, type: v.literal("start") }),
  v.object({
    forId: ForIdSchema,
    requestId: RequestIdSchema,
    type: v.literal("hit"),
  }),
  v.object({
    forId: ForIdSchema,
    requestId: RequestIdSchema,
    type: v.literal("stay"),
  }),
  v.object({
    forId: ForIdSchema,
    requestId: RequestIdSchema,
    targetId: IdSchema,
    type: v.literal("choose"),
  }),
  v.object({ requestId: RequestIdSchema, type: v.literal("nextRound") }),
  v.object({ requestId: RequestIdSchema, type: v.literal("lobby") }),
  v.object({ requestId: RequestIdSchema, type: v.literal("addBot") }),
  v.object({
    playerId: IdSchema,
    requestId: RequestIdSchema,
    type: v.literal("kick"),
  }),
  v.object({ requestId: RequestIdSchema, type: v.literal("leave") }),
  v.object({
    text: v.pipe(v.string(), v.maxLength(2000)),
    type: v.literal("chat"),
  }),
]);

export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

export type GameCommand = Exclude<ClientMessage, { type: "chat" | "join" }>;

const ClientMessageJsonSchema = v.pipe(
  v.string(),
  v.parseJson(),
  ClientMessageSchema
);

export const parseClientMessage = (raw: string) => {
  const result = v.safeParse(ClientMessageJsonSchema, raw);

  return result.success ? result.output : null;
};
