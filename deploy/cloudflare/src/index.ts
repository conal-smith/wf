/**
 * Runs the forecast worker image on Cloudflare Containers, on jobs.toml's timetable.
 *
 * A cron tick every five minutes finds the jobs whose UTC slot it is and hands
 * each to its own Durable Object, named after the job, which starts the
 * container and waits for it. One object per job is what stops a slow run
 * overlapping the next slot of the same job, as Home Compute and the local
 * scheduler both guarantee. The container exits when the import does: the
 * worker reads the bucket's current run first and stops at once if there is
 * nothing new, so a slot that finds nothing costs seconds, not an import.
 */
import { DurableObject } from "cloudflare:workers";
import schedule from "../jobs.json";

interface Job {
  id: string;
  enabled: boolean;
  description: string;
  hours?: number[];
  minutes: number[];
  size: Size;
  timeoutSeconds: number;
  args?: string[];
  entrypoint?: string[];
}

type Size = "small" | "medium" | "large" | "ensemble";

interface Env {
  FORECAST_JOB: DurableObjectNamespace<ForecastJob>;
  S3_BUCKET: string;
  S3_ENDPOINT_URL: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  FORCE5_SIDECARS: string;
  ECMWF_SOURCE: string;
  /** Optional: lets POST /run/<job> start a job by hand. */
  RUN_TOKEN?: string;
}

const JOBS = schedule.jobs as Job[];

/**
 * Memory and disk are billed for the whole run, CPU only while it works. These
 * match the Mac mini's ceilings (deploy/schedules.py): 1 GB for the station
 * feeds, 4 GB for a model with headroom for GRIB decoding, and 20 GB of disk
 * only for the ensembles, which download a few GB a run.
 */
type Instance = NonNullable<ContainerStartupOptions["instance"]>;

const INSTANCES: Record<Size, Instance> = {
  small: { vcpu: 1, memoryMib: 1024, diskMb: 4000 },
  medium: "standard-1",
  large: "standard-3",
  ensemble: { vcpu: 2, memoryMib: 8192, diskMb: 20000 },
};

/** The container's own grace beyond the importer's timeout, for start-up and upload. */
const MARGIN_MS = 10 * 60_000;

function dueAt(job: Job, time: Date): boolean {
  // No hours means every hour, as in jobs.toml.
  return job.enabled
    && (!job.hours || job.hours.includes(time.getUTCHours()))
    && job.minutes.includes(time.getUTCMinutes());
}

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, time: new Date().toISOString(), ...fields }));
}

export class ForecastJob extends DurableObject<Env> {
  private active: Promise<void> | undefined;

  /** Start the job unless this job is already running; a second slot waits on the first. */
  run(job: Job, source: string): Promise<void> {
    if (this.active) {
      log("job_skipped", { job: job.id, source, reason: "already running" });
      return this.active;
    }
    this.active = this.runOnce(job, source).finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  private async runOnce(job: Job, source: string): Promise<void> {
    const container = this.ctx.container!;
    const started = Date.now();
    // A Durable Object is evicted once idle, and its container with it; keep it
    // for as long as the importer may take, and have an alarm end it after that.
    const limit = job.timeoutSeconds * 1000 + MARGIN_MS;
    await container.setInactivityTimeout(Math.min(limit, 6 * 3_600_000));
    await this.ctx.storage.setAlarm(started + limit);
    if (!container.running) {
      container.start({
        image: container.images.worker,
        instance: INSTANCES[job.size],
        enableInternet: true,
        entrypoint: job.entrypoint ?? ["python", "/app/force5/ingest/worker.py", ...(job.args ?? [])],
        env: {
          S3_BUCKET: this.env.S3_BUCKET,
          S3_ENDPOINT_URL: this.env.S3_ENDPOINT_URL,
          AWS_ACCESS_KEY_ID: this.env.AWS_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: this.env.AWS_SECRET_ACCESS_KEY,
          AWS_REGION: this.env.AWS_REGION,
          FORCE5_SIDECARS: this.env.FORCE5_SIDECARS,
          ECMWF_SOURCE: this.env.ECMWF_SOURCE,
        },
        labels: { job: job.id },
      });
      log("job_started", { job: job.id, source, size: job.size });
    }
    try {
      await container.monitor();
      log("job_finished", { job: job.id, exitCode: 0, seconds: Math.round((Date.now() - started) / 1000) });
    } catch (error) {
      // The importer's own JSON lines (forecast_complete, forecast_failed, ...)
      // are in the container's log; this line says how the run ended.
      log("job_failed", {
        job: job.id,
        exitCode: (error as { exitCode?: number }).exitCode ?? null,
        error: String((error as Error).message ?? error),
        seconds: Math.round((Date.now() - started) / 1000),
      });
    } finally {
      await this.ctx.storage.deleteAlarm();
    }
  }

  /** The run outlived its importer's timeout and margin: stop it. */
  async alarm(): Promise<void> {
    if (this.ctx.container?.running) {
      log("job_timed_out", {});
      await this.ctx.container.destroy(new Error("timed out"));
    }
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const tick = new Date(controller.scheduledTime);
    for (const job of JOBS.filter((candidate) => dueAt(candidate, tick))) {
      // Not awaited one by one: each job's object waits on its own container.
      ctx.waitUntil(env.FORECAST_JOB.getByName(job.id).run(job, "schedule"));
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/jobs") {
      return Response.json(JOBS.map(({ id, enabled, description, hours, minutes, size }) =>
        ({ id, enabled, description, hours: hours ?? "every", minutes, size })));
    }
    const match = url.pathname.match(/^\/run\/([a-z0-9-]+)$/);
    if (request.method === "POST" && match) {
      if (!env.RUN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.RUN_TOKEN}`) {
        return new Response("unauthorized", { status: 401 });
      }
      const job = JOBS.find((candidate) => candidate.id === match[1]);
      if (!job) return new Response("unknown job", { status: 404 });
      ctx.waitUntil(env.FORECAST_JOB.getByName(job.id).run(job, "manual"));
      return Response.json({ started: job.id }, { status: 202 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
