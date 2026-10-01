# @rhythmjs/observability

Observability middleware for [Rhythm](https://github.com/rhythmjs/rhythm), the Bun-native backend
framework: request logging, request ids, `Server-Timing`, health endpoints, and graceful shutdown.
Each module is exported by its own subpath; there is no root barrel export.

## Install

```sh
bun add @rhythmjs/observability @rhythmjs/rhythm @rhythmjs/router
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
  rethrown, so an exception filter registered outside `log` still sees it.

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

- `requestId(header?)`: pass a custom header name (default `"x-request-id"`). An incoming id is only
  reused if it matches `^[A-Za-z0-9._-]{1,128}$`; anything else is replaced with a generated UUID so
  clients cannot inject arbitrary content into your logs.

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

- `timing(name?)`: pass a custom metric name (default `"app"`). Multiple `timing()` layers append their
  metrics instead of replacing each other.

## `@rhythmjs/observability/health`

Liveness/readiness endpoints and graceful shutdown, built on the Rhythm kernel. The package ships
**no indicators**; `HealthIndicator` is a contract, and you implement checks against your own
services:

```ts
import { healthModule, healthRoutes, gracefulShutdown } from "@rhythmjs/observability/health";

const dbIndicator: HealthIndicator = {
  name: "postgres",
  check: async () => (await sql`select 1`, { status: "up" }),
};

const app = new Rhythm().register(healthModule.forRoot({ indicators: [dbIndicator] }), (m) => ({
  healthService: m.healthService,
}));

router.use(healthRoutes(healthService).middleware());
// GET /health/live → 200 while the process runs (never touches indicators)
// GET /health/ready → 200, or 503 with per-check statuses (no details) in the body

gracefulShutdown({ healthService, close: () => server.close(), app });
```

- `HealthIndicator`: `{ name, check(), critical?, timeout? }`; `check` returns
  `{ status: "up" | "down", details? }`, sync or async. A throwing or hanging check reports `down`
  (with the error message, or a per-indicator `timeout` cutoff). `critical: false` shows in the
  report without failing readiness.
- `healthModule.forRoot({ indicators, timeout?, cacheTtl? })`: a Rhythm module providing
  `healthService`; export it with `register`'s second argument. Indicators run in parallel; results
  are cached for `cacheTtl` (default 1s), and concurrent calls share one in-flight run, so probe
  hammering never floods your dependencies.
  `createHealthService(options)` builds the service directly, without the module.
- `healthRoutes(service, { path?, details? })`: a `RhythmRouter` mounting `/live` and `/ready` under
  `path` (default `/health`); compose or guard it like any router. `/ready` returns only each check's
  `status` and `durationMs`; set `details: true` to include indicator `details` and error messages
  (they can reveal hosts and connection errors, so only do this behind auth). `service.ready()`
  always returns the full report for in-process use.
- `gracefulShutdown({ healthService, close?, app?, signals?, drainMs?, timeoutMs?, exit? })`: on
  SIGTERM/SIGINT: readiness flips to `503 shuttingDown`, waits
  `drainMs` for load-balancer deregistration, closes the server, then runs the kernel's `teardown()`
  (providers dispose in reverse order). Returns the trigger function for manual invocation; a
  `timeoutMs` watchdog force-exits if teardown hangs.

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
bun install
bun test # bun test runner
bun run typecheck # tsc --noEmit
bun run build # bun build + tsc declarations
```
