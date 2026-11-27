import * as v from "valibot";

import { ReactionEmojiSchema } from "./chat-reactions";
import { RoomSettingsSchema } from "./settings";
import { CHAT_TEXT_LIMIT, NAME_TEXT_LIMIT } from "./text";

const IdSchema = v.pipe(v.string(), v.maxLength(64));

const RequestIdSchema = v.optional(v.pipe(v.string(), v.uuid()));

const ForIdSchema = v.optional(IdSchema);

const GameCommandSchema = v.variant("type", [
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
    ...v.partial(RoomSettingsSchema).entries,
    requestId: RequestIdSchema,
    type: v.literal("configure"),
  }),
  v.object({
    playerId: IdSchema,
    requestId: RequestIdSchema,
    type: v.literal("kick"),
  }),
  v.object({
    playerId: IdSchema,
    requestId: RequestIdSchema,
    type: v.literal("makeHost"),
  }),
  v.object({ requestId: RequestIdSchema, type: v.literal("leave") }),
  v.object({
    emoji: v.nullable(ReactionEmojiSchema),
    messageId: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    requestId: RequestIdSchema,
    type: v.literal("react"),
  }),
]);

const ClientMessageSchema = v.variant("type", [
  ...GameCommandSchema.options,
  v.object({
    avatar: v.optional(v.number()),
    name: v.pipe(v.string(), v.maxLength(NAME_TEXT_LIMIT.units)),
    token: v.nullable(IdSchema),
    type: v.literal("join"),
  }),
  v.object({
    text: v.pipe(v.string(), v.maxLength(CHAT_TEXT_LIMIT.units)),
    type: v.literal("chat"),
  }),
  v.object({ active: v.boolean(), type: v.literal("typing") }),
  v.object({ type: v.literal("sync") }),
  v.object({ type: v.literal("watch") }),
  v.object({ type: v.literal("watchInstead") }),
  v.object({ type: v.literal("stopWatching") }),
]);

export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

export type GameCommand = v.InferOutput<typeof GameCommandSchema>;

/** Commands that can run alongside a pending move and need no reconnect confirmation. */
export const isRoomCommand = (command: GameCommand) =>
  command.type === "configure" ||
  command.type === "kick" ||
  command.type === "makeHost" ||
  command.type === "react" ||
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
