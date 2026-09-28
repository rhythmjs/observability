import { describe, expect, test } from "vite-plus/test";
import { RhythmRouter } from "@rhythmjs/router";
import { toFetchHandler } from "@rhythmjs/router/adapters/bun";
import { requestId, type RequestIdContext } from "./request-id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3,4}-[0-9a-f]{3,4}-[0-9a-f]{12}$/i;

describe("requestId", () => {
  test("generates an id, sets the response header, and extends the context", async () => {
    const app = toFetchHandler(
      new RhythmRouter().use<RequestIdContext>(requestId()).get("/ping", (ctx) => {
        ctx.response.body = ctx.requestId;
      }),
    );

    const res = await app(new Request("http://localhost/ping"));
    const body = await res.text();

    expect(body).toMatch(UUID_PATTERN);
    expect(res.headers.get("x-request-id")).toBe(body);
  });

  test("reuses an incoming request id instead of generating one", async () => {
    const app = toFetchHandler(
      new RhythmRouter().use<RequestIdContext>(requestId()).get("/ping", (ctx) => {
        ctx.response.body = ctx.requestId;
      }),
    );

    const res = await app(new Request("http://localhost/ping", { headers: { "x-request-id": "trace-123" } }));

    expect(await res.text()).toBe("trace-123");
    expect(res.headers.get("x-request-id")).toBe("trace-123");
  });

  test("generates a fresh id per request", async () => {
    const app = toFetchHandler(
      new RhythmRouter().use<RequestIdContext>(requestId()).get("/ping", (ctx) => {
        ctx.response.body = ctx.requestId;
      }),
    );

    const first = await (await app(new Request("http://localhost/ping"))).text();
    const second = await (await app(new Request("http://localhost/ping"))).text();

    expect(first).not.toBe(second);
  });

  test("supports a custom header name", async () => {
    const app = toFetchHandler(
      new RhythmRouter().use<RequestIdContext>(requestId("x-trace-id")).get("/ping", (ctx) => {
        ctx.response.body = ctx.requestId;
      }),
    );

    const res = await app(new Request("http://localhost/ping", { headers: { "x-trace-id": "abc" } }));

    expect(await res.text()).toBe("abc");
    expect(res.headers.get("x-trace-id")).toBe("abc");
    expect(res.headers.get("x-request-id")).toBeNull();
  });
});
