# @rhythmjs/observability

Observability middleware for [Rhythm](https://github.com/rhythmjs/rhythm) routers and handlers. Each module
is exported by its own subpath — there is no root barrel export.

## Install

```sh
pnpm add @rhythmjs/observability @rhythmjs/rhythm @rhythmjs/router
```

## `@rhythmjs/observability/log`

Request logging: wraps the chain and reports method, path, status, and duration per request.

```ts
import { RhythmRouter } from "@rhythmjs/router";
import { log } from "@rhythmjs/observability/log";

new RhythmRouter().use(log()).get("/users/:id", (ctx) => {
  ctx.response.body = "ok";
});
// => GET /users/7 200 2ms
```

- `log()` prints `METHOD /path status Nms` to the console.
- `log(sink)` calls your sink (sync or async) with a structured `LogEntry`:
  `{ method, path, status, duration, error? }`.
- When downstream throws, the entry is logged with `status: 500` and the `error`, then the error is
  rethrown — so an exception filter registered outside `log` still sees it.

Exported types: `LogEntry`, `LogSink`.

## `@rhythmjs/observability/request-id`

Correlates each request with an id: reuses the incoming `x-request-id` header or generates a
`crypto.randomUUID()`, sets it on the response, and extends the context with `ctx.requestId`.

```ts
import { requestId, type RequestIdContext } from "@rhythmjs/observability/request-id";

new RhythmRouter().use<RequestIdContext>(requestId()).get("/ping", (ctx) => {
  ctx.requestId; // string, also sent as the x-request-id response header
});
```

- `requestId(header?)` — pass a custom header name (default `"x-request-id"`).

Exported types: `RequestIdContext`.

## `@rhythmjs/observability/timing`

Appends a [`Server-Timing`](https://developer.mozilla.org/docs/Web/HTTP/Headers/Server-Timing) header with
the duration of everything downstream, visible in browser devtools.

```ts
import { timing } from "@rhythmjs/observability/timing";

new RhythmRouter().use(timing()).get("/ping", (ctx) => {
  ctx.response.body = "pong";
});
// => server-timing: app;dur=1.2
```

- `timing(name?)` — pass a custom metric name (default `"app"`). Multiple `timing()` layers append their
  metrics instead of replacing each other.

## Composition

Register `log` outermost so it measures and reports everything, then `timing` and `request-id`:

```ts
new RhythmRouter()
  .use(log())
  .use(timing())
  .use<RequestIdContext>(requestId())
  .get("/users/:id", (ctx) => {
    ctx.response.body = ctx.requestId;
  });
```

## Development

```sh
pnpm install
pnpm test       # vp test
pnpm typecheck  # tsc --noEmit
pnpm build      # vp pack
```
