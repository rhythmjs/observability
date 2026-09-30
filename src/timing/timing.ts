import type { Middleware } from "@rhythmjs/rhythm/types";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";

export function timing(name = "app"): Middleware<RhythmHttpContext> {
  return async (ctx, next) => {
    const start = Bun.nanoseconds();
    await next();
    const duration = ((Bun.nanoseconds() - start) / 1e6).toFixed(1);
    ctx.response.headers.append("server-timing", `${name};dur=${duration}`);
  };
}
