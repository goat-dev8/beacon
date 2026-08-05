import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { Redis } from "@upstash/redis";
import { z } from "zod";
import { ExecutionPhaseSchema, type ExecutionPhase } from "@beacon/execution";
import { AppError, isAppError } from "@beacon/shared";
import { createExecution, transitionPhase } from "./engine.js";
import { ensureExecutionSchema, getExecutionById, listExecutionEvents, toEventDto, toExecutionDto } from "./store.js";
import { listRegisteredWorkflows } from "./workflows.js";

const walletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/i);

export async function registerExecutionRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  redis: Redis | null,
): Promise<void> {
  await ensureExecutionSchema(pool);

  app.get("/v1/executions/workflows", async () => ({
    ok: true,
    workflows: listRegisteredWorkflows(),
  }));

  app.post("/v1/executions", async (req) => {
    const body = z
      .object({
        wallet: walletSchema,
        workflowType: z.string().min(1),
        workflowVersion: z.string().min(1).optional(),
        immutableInput: z.unknown().optional(),
        conversationId: z.string().uuid().optional(),
        idempotencyKey: z.string().min(8).max(128).optional(),
      })
      .parse(req.body ?? {});

    const result = await createExecution(pool, body);
    return { ok: true, ...result };
  });

  app.get("/v1/executions/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const row = await getExecutionById(pool, id);
    if (!row) {
      throw new AppError("JOB_NOT_FOUND", { message: "Execution not found." });
    }
    return { ok: true, execution: toExecutionDto(row) };
  });

  app.post("/v1/executions/:id/transition", async (req) => {
    const id = (req.params as { id: string }).id;
    const body = z
      .object({
        toPhase: ExecutionPhaseSchema,
        reason: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});

    try {
      const result = await transitionPhase(pool, redis, id, body.toPhase as ExecutionPhase, body.reason);
      return { ok: true, ...result };
    } catch (err) {
      if (isAppError(err)) throw err;
      throw err;
    }
  });

  app.get("/v1/executions/:id/events", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const afterSeq = Number((req.query as { afterSeq?: string }).afterSeq ?? 0) || 0;
    const live = (req.query as { live?: string }).live !== "false";

    const row = await getExecutionById(pool, id);
    if (!row) {
      throw new AppError("JOB_NOT_FOUND", { message: "Execution not found." });
    }

    const accept = req.headers.accept ?? "";
    const wantsSse = accept.includes("text/event-stream") || live;

    if (!wantsSse) {
      const events = await listExecutionEvents(pool, id, afterSeq);
      return { ok: true, events: events.map(toEventDto) };
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let cursor = afterSeq;
    const terminalPhases = new Set(["completed", "canceled", "expired", "refunded", "failed"]);

    const sendEvents = async () => {
      const events = await listExecutionEvents(pool, id, cursor);
      for (const event of events) {
        cursor = event.seq;
        reply.raw.write(`id: ${event.seq}\n`);
        reply.raw.write(`event: ${event.event_type}\n`);
        reply.raw.write(`data: ${JSON.stringify(toEventDto(event))}\n\n`);
      }
      return events.length;
    };

    await sendEvents();

    if (terminalPhases.has(row.phase)) {
      reply.raw.end();
      return reply;
    }

    const interval = setInterval(async () => {
      try {
        await sendEvents();
        const current = await getExecutionById(pool, id);
        if (!current || terminalPhases.has(current.phase)) {
          clearInterval(interval);
          reply.raw.end();
        }
      } catch {
        clearInterval(interval);
        reply.raw.end();
      }
    }, 1500);

    req.raw.on("close", () => {
      clearInterval(interval);
    });

    return reply;
  });
}
