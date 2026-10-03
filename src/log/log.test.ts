import { describe, expect, test } from "bun:test";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
import { log, type LogEntry } from "./log";

const serve = (router: RhythmRouter) => toFetchHandler(new Rhythm<RhythmHttpContext>().use(router.middleware()));

describe("log", () => {
  test("records method, path, status, and duration for a handled request", async () => {
    const entries: LogEntry[] = [];
    const app = serve(
      new RhythmRouter().use(log((entry) => void entries.push(entry))).get("/users/:id", (ctx) => {
        ctx.text("ok", 201);
      }),
    );

    await app(new Request("http://localhost/users/7?verbose=1"));

    expect(entries).toHaveLength(1);
    expect(entries[0].method).toBe("GET");
    expect(entries[0].path).toBe("/users/7");
    expect(entries[0].status).toBe(201);
    expect(entries[0].duration).toBeGreaterThanOrEqual(0);
    expect(entries[0].error).toBeUndefined();
  });

  test("logs one entry per request across routes", async () => {
    const entries: LogEntry[] = [];
    const app = serve(
      new RhythmRouter()
        .use(log((entry) => void entries.push(entry)))
        .get("/a", (ctx) => {
          ctx.text("a");
        })
        .post("/b", (ctx) => {
          ctx.text("b");
        }),
    );

    await app(new Request("http://localhost/a"));
    await app(new Request("http://localhost/b", { method: "POST" }));

    expect(entries.map((entry) => `${entry.method} ${entry.path}`)).toEqual(["GET /a", "POST /b"]);
  });

  test("logs a 500 entry with the error and rethrows when downstream throws", async () => {
    const entries: LogEntry[] = [];
    const boom = new Error("boom");
    const app = serve(
      new RhythmRouter().use(log((entry) => void entries.push(entry))).get("/boom", () => {
        throw boom;
      }),
    );

    await expect(app(new Request("http://localhost/boom"))).rejects.toThrow("boom");
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe(500);
    expect(entries[0].error).toBe(boom);
  });

  test("supports an async sink", async () => {
    const entries: LogEntry[] = [];
    const app = serve(
      new RhythmRouter()
        .use(
          log(async (entry) => {
            await Promise.resolve();
            entries.push(entry);
          }),
        )
        .get("/async", (ctx) => {
          ctx.text("ok");
        }),
    );

    await app(new Request("http://localhost/async"));

    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/async");
  });
});
