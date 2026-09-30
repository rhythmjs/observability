import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";

export type HealthStatus = "up" | "down";

export interface HealthResult {
  status: HealthStatus;
  details?: Record<string, unknown>;
}

export interface HealthIndicator {
  name: string;
  critical?: boolean;
  timeout?: number;
  check(): HealthResult | Promise<HealthResult>;
}

export interface HealthCheck {
  status: HealthStatus;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;
  shuttingDown: boolean;
  checks: Record<string, HealthCheck>;
}

export interface HealthService {
  readonly isShuttingDown: boolean;
  live(): { status: "up"; uptime: number; timestamp: string };
  ready(): Promise<HealthReport>;
  shutdown(): void;
}

export interface HealthModuleOptions {
  indicators?: HealthIndicator[];
  timeout?: number;
  cacheTtl?: number;
}

export function createHealthService(options: HealthModuleOptions = {}): HealthService {
  const indicators = options.indicators ?? [];
  const defaultTimeout = options.timeout ?? 5000;
  const cacheTtl = options.cacheTtl ?? 1000;
  const startedAt = Date.now();
  let shuttingDown = false;
  let cached: { report: HealthReport; expires: number } | null = null;

  const runIndicator = async (indicator: HealthIndicator): Promise<[string, HealthCheck]> => {
    const start = performance.now();
    const timeout = indicator.timeout ?? defaultTimeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve(indicator.check()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeout}ms`)), timeout);
        }),
      ]);
      return [
        indicator.name,
        {
          status: result.status,
          durationMs: Math.round(performance.now() - start),
          ...(result.details ? { details: result.details } : {}),
        },
      ];
    } catch (error) {
      return [
        indicator.name,
        {
          status: "down",
          durationMs: Math.round(performance.now() - start),
          details: { error: error instanceof Error ? error.message : String(error) },
        },
      ];
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get isShuttingDown() {
      return shuttingDown;
    },
    live: () => ({
      status: "up",
      uptime: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    }),
    ready: async (): Promise<HealthReport> => {
      if (shuttingDown) return { status: "down", shuttingDown: true, checks: {} };
      if (cached !== null && cached.expires > Date.now()) return cached.report;

      const entries = await Promise.all(indicators.map(runIndicator));
      const checks = Object.fromEntries(entries);
      const down = indicators.some(
        (indicator) => (indicator.critical ?? true) && checks[indicator.name]?.status === "down",
      );
      const report: HealthReport = { status: down ? "down" : "up", shuttingDown: false, checks };
      cached = { report, expires: Date.now() + cacheTtl };
      return report;
    },
    shutdown: () => {
      shuttingDown = true;
      cached = null;
    },
  };
}

export const healthModule = {
  forRoot(options: HealthModuleOptions = {}) {
    return new Rhythm({ type: "module", name: "health" }).provide(() => ({
      healthService: createHealthService(options),
    }));
  },
};

export interface HealthRoutesOptions {
  path?: string;
}

export function healthRoutes(service: HealthService, options: HealthRoutesOptions = {}): RhythmRouter {
  return new RhythmRouter({ prefix: options.path ?? "/health" })
    .get("/live", (ctx) => {
      ctx.json(service.live());
    })
    .get("/ready", async (ctx) => {
      const report = await service.ready();
      ctx.json(report, report.status === "up" ? 200 : 503);
    });
}

export interface GracefulShutdownOptions {
  healthService?: HealthService;
  app?: { teardown(): void | Promise<void> };
  close?: () => void | Promise<void>;
  signals?: string[];
  drainMs?: number;
  timeoutMs?: number;
  exit?: boolean;
}

export function gracefulShutdown(options: GracefulShutdownOptions = {}): () => Promise<void> {
  const signals = options.signals ?? ["SIGTERM", "SIGINT"];
  const drainMs = options.drainMs ?? 0;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const g = globalThis as {
    process?: { once(event: string, listener: () => void): unknown; exit(code?: number): never };
    Deno?: { addSignalListener?(signal: string, handler: () => void): void };
  };
  const exit = options.exit ?? g.process !== undefined;
  let started = false;

  const run = async (): Promise<void> => {
    if (started) return;
    started = true;

    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    if (exit && g.process !== undefined) {
      forceTimer = setTimeout(() => g.process!.exit(1), timeoutMs);
      (forceTimer as { unref?: () => void }).unref?.();
    }

    options.healthService?.shutdown();
    if (drainMs > 0) await new Promise((resolve) => setTimeout(resolve, drainMs));
    await options.close?.();
    await options.app?.teardown();

    clearTimeout(forceTimer);
    if (exit && g.process !== undefined) g.process.exit(0);
  };

  for (const signal of signals) {
    if (g.Deno?.addSignalListener !== undefined) {
      try {
        g.Deno.addSignalListener(signal, () => void run());
      } catch {
        // signal not supported on this platform
      }
    } else if (g.process !== undefined) {
      g.process.once(signal, () => void run());
    }
  }

  return run;
}
