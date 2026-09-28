import type { Middleware } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";

export type RequestIdContext = {
  requestId: string;
};

export function requestId(header = "x-request-id"): Middleware<RhythmHttpContext> {
  return async (ctx, next) => {
    const id = ctx.request.headers.get(header) ?? crypto.randomUUID();
    ctx.response.headers.set(header, id);
    await next({ requestId: id } satisfies RequestIdContext);
  };
}
