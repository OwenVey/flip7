import * as v from "valibot";

import { BOT_SPEEDS, TARGET_SCORES } from "./settings";

const IdSchema = v.pipe(v.string(), v.maxLength(64));

const RequestIdSchema = v.optional(v.pipe(v.string(), v.uuid()));

const ForIdSchema = v.optional(IdSchema);

const ClientMessageSchema = v.variant("type", [
  v.object({
    avatar: v.optional(v.number()),
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
    botSpeed: v.optional(v.picklist(BOT_SPEEDS)),
    locked: v.optional(v.boolean()),
    requestId: RequestIdSchema,
    targetScore: v.optional(v.picklist(TARGET_SCORES)),
    type: v.literal("configure"),
  }),
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

/** Commands that can run alongside a pending move and need no reconnect confirmation. */
export const isRoomCommand = (command: GameCommand) =>
  command.type === "configure" ||
  command.type === "kick" ||
  command.type === "leave";

const ClientMessageJsonSchema = v.pipe(
  v.string(),
  v.parseJson(),
  ClientMessageSchema
);

export const parseClientMessage = (raw: string) => {
  const result = v.safeParse(ClientMessageJsonSchema, raw);

  return result.success ? result.output : null;
};
