import type { DeriveMiddleware, Middleware } from "@rhythmjs/rhythm/types";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";

export type RequestIdContext = {
  requestId: string;
};

export function requestId(header = "x-request-id"): DeriveMiddleware<RhythmHttpContext, RequestIdContext> {
  const middleware: Middleware<RhythmHttpContext & Partial<RequestIdContext>> = async (ctx, next) => {
    const id = ctx.request.headers.get(header) ?? crypto.randomUUID();
    ctx.response.headers.set(header, id);
    ctx.requestId = id;
    await next();
  };
  return middleware as DeriveMiddleware<RhythmHttpContext, RequestIdContext>;
}
