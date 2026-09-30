import { describe, expect, test } from "bun:test";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
import { timing } from "./timing";

const serve = (router: RhythmRouter) => toFetchHandler(new Rhythm<RhythmHttpContext>().use(router.middleware()));

describe("timing", () => {
  test("adds a server-timing header with the total duration", async () => {
    const app = serve(
      new RhythmRouter().use(timing()).get("/ping", (ctx) => {
        ctx.response.body = "pong";
      }),
    );

    const res = await app(new Request("http://localhost/ping"));
    const header = res.headers.get("server-timing");

    expect(header).toMatch(/^app;dur=\d+(\.\d+)?$/);
  });

  test("supports a custom metric name", async () => {
    const app = serve(
      new RhythmRouter().use(timing("gateway")).get("/ping", (ctx) => {
        ctx.response.body = "pong";
      }),
    );

    const res = await app(new Request("http://localhost/ping"));

    expect(res.headers.get("server-timing")).toMatch(/^gateway;dur=/);
  });

  test("appends to existing server-timing metrics instead of replacing them", async () => {
    const app = serve(
      new RhythmRouter()
        .use(timing("total"))
        .use(timing("inner"))
        .get("/ping", (ctx) => {
          ctx.response.body = "pong";
        }),
    );

    const res = await app(new Request("http://localhost/ping"));
    const header = res.headers.get("server-timing") ?? "";

    expect(header).toContain("total;dur=");
    expect(header).toContain("inner;dur=");
  });

  test("measures downstream work", async () => {
    const app = serve(
      new RhythmRouter().use(timing()).get("/slow", async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        ctx.response.body = "done";
      }),
    );

    const res = await app(new Request("http://localhost/slow"));
    const duration = Number(/dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "")?.[1]);

    expect(duration).toBeGreaterThanOrEqual(20);
  });
});
