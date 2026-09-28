import type { Middleware } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";

export function timing(name = "app"): Middleware<RhythmHttpContext> {
  return async (ctx, next) => {
    const start = performance.now();
    await next();
    const duration = (performance.now() - start).toFixed(1);
    ctx.response.headers.append("server-timing", `${name};dur=${duration}`);
  };
}
