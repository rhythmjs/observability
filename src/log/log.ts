import type { Middleware } from "@rhythmjs/rhythm/types";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";

export interface LogEntry {
  method: string;
  path: string;
  status: number;
  duration: number;
  error?: unknown;
}

export type LogSink = (entry: LogEntry) => void | Promise<void>;

const defaultSink: LogSink = (entry) => {
  console.log(`${entry.method} ${entry.path} ${entry.status} ${entry.duration}ms`);
};

export function log(sink: LogSink = defaultSink): Middleware<RhythmHttpContext> {
  return async (ctx, next) => {
    const start = performance.now();
    const method = ctx.request.method;
    const path = new URL(ctx.request.url).pathname;

    try {
      await next();
    } catch (error) {
      await sink({ method, path, status: 500, duration: Math.round(performance.now() - start), error });
      throw error;
    }
    await sink({ method, path, status: ctx.response.status, duration: Math.round(performance.now() - start) });
  };
}
