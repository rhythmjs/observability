import { describe, expect, test } from "bun:test";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
import { requestId } from "./request-id";

const serve = (router: RhythmRouter<any>) => toFetchHandler(new Rhythm<RhythmHttpContext>().use(router.middleware()));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3,4}-[0-9a-f]{3,4}-[0-9a-f]{12}$/i;

describe("requestId", () => {
  test("generates an id, sets the response header, and extends the context", async () => {
    const app = serve(
      new RhythmRouter().use(requestId()).get("/ping", (ctx) => {
        ctx.text(ctx.requestId);
      }),
    );

    const res = await app(new Request("http://localhost/ping"));
    const body = await res.text();

    expect(body).toMatch(UUID_PATTERN);
    expect(res.headers.get("x-request-id")).toBe(body);
  });

  test("reuses an incoming request id instead of generating one", async () => {
    const app = serve(
      new RhythmRouter().use(requestId()).get("/ping", (ctx) => {
        ctx.text(ctx.requestId);
      }),
    );

    const res = await app(new Request("http://localhost/ping", { headers: { "x-request-id": "trace-123" } }));

    expect(await res.text()).toBe("trace-123");
    expect(res.headers.get("x-request-id")).toBe("trace-123");
  });

  test("replaces malformed or oversized incoming ids with a generated one", async () => {
    const app = serve(
      new RhythmRouter().use(requestId()).get("/ping", (ctx) => {
        ctx.text(ctx.requestId);
      }),
    );

    for (const bad of ["a".repeat(129), "has space", "line\tbreak", "<script>", "caf\u00e9"]) {
      const res = await app(new Request("http://localhost/ping", { headers: { "x-request-id": bad } }));
      const id = await res.text();
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  test("generates a fresh id per request", async () => {
    const app = serve(
      new RhythmRouter().use(requestId()).get("/ping", (ctx) => {
        ctx.text(ctx.requestId);
      }),
    );

    const first = await (await app(new Request("http://localhost/ping"))).text();
    const second = await (await app(new Request("http://localhost/ping"))).text();

    expect(first).not.toBe(second);
  });

  test("supports a custom header name", async () => {
    const app = serve(
      new RhythmRouter().use(requestId("x-trace-id")).get("/ping", (ctx) => {
        ctx.text(ctx.requestId);
      }),
    );

    const res = await app(new Request("http://localhost/ping", { headers: { "x-trace-id": "abc" } }));

    expect(await res.text()).toBe("abc");
    expect(res.headers.get("x-trace-id")).toBe("abc");
    expect(res.headers.get("x-request-id")).toBeNull();
  });
});
