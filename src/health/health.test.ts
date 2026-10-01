import { describe, expect, test } from "bun:test";
import { Rhythm } from "@rhythmjs/rhythm";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
import {
  createHealthService,
  gracefulShutdown,
  healthModule,
  healthRoutes,
  type HealthIndicator,
  type HealthReport,
} from "./health";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const up = (name: string): HealthIndicator => ({ name, check: () => ({ status: "up" }) });
const down = (name: string, critical?: boolean): HealthIndicator => ({
  name,
  ...(critical === undefined ? {} : { critical }),
  check: () => ({ status: "down", details: { reason: "unreachable" } }),
});

const serveHealth = (service: ReturnType<typeof createHealthService>, path?: string, details?: boolean) =>
  toFetchHandler(
    new Rhythm<RhythmHttpContext>().use(
      healthRoutes(service, {
        ...(path === undefined ? {} : { path }),
        ...(details === undefined ? {} : { details }),
      }).middleware(),
    ),
  );

describe("createHealthService", () => {
  test("live reports up without touching indicators", () => {
    let called = false;
    const service = createHealthService({
      indicators: [{ name: "db", check: () => ((called = true), { status: "up" }) }],
    });

    const live = service.live();
    expect(live.status).toBe("up");
    expect(live.uptime).toBeGreaterThanOrEqual(0);
    expect(called).toBe(false);
  });

  test("ready aggregates indicators and fails on a critical down", async () => {
    const service = createHealthService({ indicators: [up("db"), down("cache")] });

    const report = await service.ready();
    expect(report.status).toBe("down");
    expect(report.checks.db?.status).toBe("up");
    expect(report.checks.cache).toMatchObject({ status: "down", details: { reason: "unreachable" } });
  });

  test("a non-critical down leaves overall status up", async () => {
    const service = createHealthService({ indicators: [up("db"), down("metrics", false)] });

    const report = await service.ready();
    expect(report.status).toBe("up");
    expect(report.checks.metrics?.status).toBe("down");
  });

  test("a throwing indicator reports down with the error message", async () => {
    const service = createHealthService({
      indicators: [{ name: "db", check: () => Promise.reject(new Error("connection refused")) }],
    });

    const report = await service.ready();
    expect(report.checks.db).toMatchObject({ status: "down", details: { error: "connection refused" } });
  });

  test("a hanging indicator is timed out", async () => {
    const service = createHealthService({
      indicators: [{ name: "slow", timeout: 20, check: () => new Promise(() => {}) }],
      cacheTtl: 0,
    });

    const report = await service.ready();
    expect(report.status).toBe("down");
    expect(report.checks.slow?.details).toEqual({ error: "timed out after 20ms" });
  });

  test("results are cached for cacheTtl", async () => {
    let calls = 0;
    const counting: HealthIndicator = { name: "db", check: () => (calls++, { status: "up" }) };
    const service = createHealthService({ indicators: [counting], cacheTtl: 30 });

    await service.ready();
    await service.ready();
    expect(calls).toBe(1);

    await sleep(50);
    await service.ready();
    expect(calls).toBe(2);
  });

  test("concurrent ready() calls share one in-flight run", async () => {
    let calls = 0;
    const slow: HealthIndicator = {
      name: "db",
      check: async () => (calls++, await sleep(20), { status: "up" }),
    };
    const service = createHealthService({ indicators: [slow], cacheTtl: 0 });

    const reports = await Promise.all([service.ready(), service.ready(), service.ready()]);

    expect(calls).toBe(1);
    expect(reports[1]).toBe(reports[0]);

    await service.ready();
    expect(calls).toBe(2);
  });

  test("shutdown flips readiness to down immediately", async () => {
    const service = createHealthService({ indicators: [up("db")] });
    expect((await service.ready()).status).toBe("up");

    service.shutdown();
    expect(service.isShuttingDown).toBe(true);
    expect(await service.ready()).toEqual({ status: "down", shuttingDown: true, checks: {} });
  });
});

describe("healthRoutes", () => {
  test("serves live and ready with correct status codes", async () => {
    const service = createHealthService({ indicators: [up("db")] });
    const handler = serveHealth(service);

    const live = await handler(new Request("http://localhost/health/live"));
    expect(live.status).toBe(200);
    expect(((await live.json()) as { status: string }).status).toBe("up");

    const ready = await handler(new Request("http://localhost/health/ready"));
    expect(ready.status).toBe(200);

    service.shutdown();
    const draining = await handler(new Request("http://localhost/health/ready"));
    expect(draining.status).toBe(503);
    expect(((await draining.json()) as HealthReport).shuttingDown).toBe(true);
  });

  test("ready responds 503 when a critical indicator is down", async () => {
    const handler = serveHealth(createHealthService({ indicators: [down("db")] }));

    const ready = await handler(new Request("http://localhost/health/ready"));
    expect(ready.status).toBe(503);
    expect(((await ready.json()) as HealthReport).checks.db?.status).toBe("down");
  });

  test("omits indicator details from /ready unless details is enabled", async () => {
    const service = createHealthService({ indicators: [down("db")] });

    const hidden = (await (
      await serveHealth(service)(new Request("http://localhost/health/ready"))
    ).json()) as HealthReport;
    expect(hidden.checks.db).toEqual({ status: "down", durationMs: expect.any(Number) });

    const shown = await serveHealth(service, undefined, true)(new Request("http://localhost/health/ready"));
    expect(((await shown.json()) as HealthReport).checks.db?.details).toEqual({ reason: "unreachable" });
  });

  test("mounts under a custom path", async () => {
    const handler = serveHealth(createHealthService(), "/status");

    const mounted = await handler(new Request("http://localhost/status/live"));
    expect(mounted.status).toBe(200);
    expect(((await mounted.json()) as { status: string }).status).toBe("up");

    const unmounted = await handler(new Request("http://localhost/health/live"));
    expect(await unmounted.text()).toBe("");
  });
});

describe("healthModule", () => {
  test("exports the service through register", async () => {
    const app = new Rhythm().register(healthModule.forRoot({ indicators: [up("db")] }), (m) => ({
      healthService: m.healthService,
    }));

    await app.setup();
    const ctx = await app.run({});

    expect(ctx.healthService.live().status).toBe("up");
    expect((await ctx.healthService.ready()).status).toBe("up");
  });
});

describe("gracefulShutdown", () => {
  test("drains, closes, and tears down in order, exactly once", async () => {
    const order: string[] = [];
    const service = createHealthService();
    const trigger = gracefulShutdown({
      healthService: service,
      close: () => void order.push("close"),
      app: { teardown: () => void order.push("teardown") },
      signals: [],
      exit: false,
    });

    await trigger();
    await trigger();

    expect(order).toEqual(["close", "teardown"]);
    expect(service.isShuttingDown).toBe(true);
  });
});
