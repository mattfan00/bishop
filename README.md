# bishop

bishop is a middleware based file watcher built on top of `Deno.watchFs`.

Inspired by the HTTP middleware framework [oak](https://github.com/oakserver/oak)

## Quick start

To start watching the current directory:

```ts
import { Watcher } from "https://deno.land/x/bishop/mod.ts";
import { createHandler } from "./handlers.ts"

const watcher = new Watcher(".");

// log every event
watcher.use(async (ctx, next) => {
  console.log(`${new Date().toISOString()} - ${ctx.event} ${ctx.path}`);
  await next();
})

watcher.use((ctx) => {
  if (ctx.event === "create") {
    createHandler(ctx.path);
  }
});

await watcher.watch();
```