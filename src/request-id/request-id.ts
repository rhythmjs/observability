import type { DeriveMiddleware, Middleware } from "@rhythmjs/rhythm/types";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";

export type RequestIdContext = {
  requestId: string;
};

const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestId(header = "x-request-id"): DeriveMiddleware<RhythmHttpContext, RequestIdContext> {
  const middleware: Middleware<RhythmHttpContext & Partial<RequestIdContext>> = async (ctx, next) => {
    const incoming = ctx.request.headers.get(header);
    const id = incoming !== null && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
    ctx.response.headers.set(header, id);
    ctx.requestId = id;
    await next();
  };
  return middleware as DeriveMiddleware<RhythmHttpContext, RequestIdContext>;
}
