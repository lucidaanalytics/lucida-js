# @lucida-analytics/convex

A [Convex](https://convex.dev) component for Lucida product analytics and feature flags (LC-DX-42).
Needs `convex` >= 1.17 in your app (it is not a dependency of this package).

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import lucida from "@lucida-analytics/convex/convex.config";

const app = defineApp();
app.use(lucida);
export default app;
```

```ts
// convex/users.ts
import { Lucida } from "@lucida-analytics/convex";
import { components } from "./_generated/api";

const lucida = new Lucida(components.lucida); // LUCIDA_API_KEY (lc_pk_...) and optional LUCIDA_HOST from the Convex dashboard

export const signUp = mutation({
  handler: async (ctx, { plan }) => {
    const id = await ctx.db.insert("users", { plan });
    await lucida.capture(ctx, id, "signed_up", { plan }); // scheduled: sent only if the mutation commits
  },
});

export const pricing = action({
  handler: async (ctx, { userId }) => lucida.isFeatureEnabled(ctx, "new-pricing", userId),
});
```

- Mutations and queries cannot fetch, so `capture` from a mutation schedules the component's `capture` action
  (`ctx.scheduler.runAfter(0, ...)`); from an action it runs it directly.
- The event uuid and timestamp are fixed by the caller, so a re-run action sends the same uuid and the gateway
  dedupes (at-least-once, never exactly-once).
- Flags are actions only (`getFeatureFlag`, `isFeatureEnabled`, `getAllFlags`), evaluated remotely with the public key.
- Components do not see the app's environment, so the key is read in your function and passed as an argument.

## Tests

`pnpm --filter @lucida-analytics/convex test` covers the client and the action bodies (`src/component/handlers.ts`).
`src/component/lib.ts` and `convex.config.ts` import `convex` and are type-checked in the host app, not here.
