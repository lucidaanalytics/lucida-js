// Convex component functions. Typechecked only where `convex` is installed (the host app or CI):
// this repo does not depend on convex, so tsconfig excludes this file (see README).
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import { captureHandler, flagsHandler } from "./handlers.js";

const props = v.optional(v.record(v.string(), v.any()));

export const capture = actionGeneric({
  args: { apiKey: v.string(), host: v.optional(v.string()), distinctId: v.string(), event: v.string(), properties: props, uuid: v.string(), timestamp: v.string() },
  returns: v.null(),
  handler: (_ctx, args) => captureHandler(args),
});

export const flags = actionGeneric({
  args: {
    apiKey: v.string(),
    host: v.optional(v.string()),
    key: v.optional(v.string()),
    distinctId: v.string(),
    personProperties: props,
    groups: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.any(),
  handler: (_ctx, args) => flagsHandler(args),
});
