import type { ThreadEvent, Usage } from "@openai/codex-sdk";
import type { IdeasRequest, IdeasResponse } from "../src/ideas/schema.ts";

export function ideasResponse(prefix = "concept", count = 10): IdeasResponse {
  return {
    ideas: Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${String(index + 1)}`,
      name: `${prefix} ${String(index + 1)}`,
      composition:
        "A broad castle silhouette above a harbor with a ship-shaped opening",
      literary_basis: "The sea voyage connects the castle to the English coast",
      palette: [
        { color: "#80182A", use: "Castle walls" },
        { color: "#183D49", use: "Harbor" },
        { color: "#FAF4E8", use: "Suggested poster field at render time" },
      ],
      conversion_resilience:
        "Broad masses and wide openings survive a character grid",
    })),
  };
}

export const fixtureUsage: Usage = {
  input_tokens: 100,
  cached_input_tokens: 20,
  cache_write_input_tokens: 0,
  output_tokens: 200,
  reasoning_output_tokens: 0,
};

export function responseEvents(
  response = JSON.stringify(ideasResponse()),
): ThreadEvent[] {
  return [
    { type: "thread.started", thread_id: "fixture-thread" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "agent_message", id: "message", text: response },
    },
    { type: "turn.completed", usage: fixtureUsage },
  ];
}

// Ignores its input so it can stand in for any Codex-backed generator.
export function fakeGenerator(
  events = responseEvents(),
): () => AsyncGenerator<ThreadEvent> {
  return async function* (): AsyncGenerator<ThreadEvent> {
    for (const event of events) {
      yield await Promise.resolve(event);
    }
  };
}

export async function rejection(
  promise: Promise<unknown>,
): Promise<() => never> {
  try {
    await promise;
  } catch (error) {
    return (): never => {
      throw error;
    };
  }
  throw new Error("Expected a rejected promise");
}

export function request(outputRoot: string): IdeasRequest {
  return {
    title: "Dracula",
    author: "Bram Stoker",
    slug: "dracula",
    outputRoot,
    timeoutSeconds: 5,
    ideaCount: 10,
  };
}
