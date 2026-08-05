import { randomUUID } from "node:crypto";
import type { ExecutionEvent, ExecutionEventType, ExecutionPhase } from "./types.js";

export interface InMemoryEventStore {
  events: ExecutionEvent[];
  seqByExecution: Map<string, number>;
}

export function createInMemoryEventStore(): InMemoryEventStore {
  return {
    events: [],
    seqByExecution: new Map(),
  };
}

export interface AppendExecutionEventInput {
  executionId: string;
  type: ExecutionEventType;
  phase?: ExecutionPhase;
  payload?: unknown;
  createdAt?: string;
}

export function appendExecutionEvent(
  store: InMemoryEventStore,
  input: AppendExecutionEventInput,
): ExecutionEvent {
  const nextSeq = (store.seqByExecution.get(input.executionId) ?? 0) + 1;
  store.seqByExecution.set(input.executionId, nextSeq);

  const event: ExecutionEvent = {
    id: randomUUID(),
    executionId: input.executionId,
    seq: nextSeq,
    type: input.type,
    phase: input.phase,
    payload: input.payload ?? {},
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  store.events.push(event);
  return event;
}

export function getExecutionEvents(
  store: InMemoryEventStore,
  executionId: string,
): ExecutionEvent[] {
  return store.events.filter((event) => event.executionId === executionId);
}

export function replayExecutionEvents(
  store: InMemoryEventStore,
  executionId: string,
  afterSeq = 0,
): ExecutionEvent[] {
  return getExecutionEvents(store, executionId).filter((event) => event.seq > afterSeq);
}
