import {
  executeHarnessRollout,
  type HarnessPolicyMessage,
  type HarnessPolicyToolCall,
} from "@openpond/harness";
import { z } from "zod";
import {
  RetailRuntime,
  StepSchema,
  revision,
  model,
  type Step,
} from "./runtime.js";
const Context = z.object({
  policy: z.string(),
  tools: z.array(z.record(z.string(), z.unknown())),
  userPrompt: z.string().optional(),
});
export type Policy = (
  request: {
    messages: HarnessPolicyMessage[];
    tools: Record<string, unknown>[];
  },
  signal: AbortSignal,
) => Promise<{
  content: string | null;
  toolCalls: HarnessPolicyToolCall[];
  result: unknown;
}>;

export async function runAttempt(input: {
  taskId: string;
  signal: AbortSignal;
  policy: Policy;
  live: boolean;
  maxTurns?: number;
  userPrompt?: string;
}) {
  const maxTurns = input.maxTurns ?? 24;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 50)
    throw new Error("maxTurns must be between 1 and 50");
  const runtime = new RetailRuntime(input.signal, 180_000);
  try {
    const context = Context.parse(
      await runtime.request({
        op: input.live ? "live_start" : "start",
        taskId: input.taskId,
        maxTurns,
      }),
    );
    const result = await executeHarnessRollout<unknown, Step>({
      turnId: crypto.randomUUID(),
      maxTurns,
      signal: input.signal,
      runtime: null,
      systemPrompt: context.policy,
      userPrompt:
        context.userPrompt ??
        input.userPrompt ??
        "Controlled tool fixture; not a simulated customer conversation.",
      tools: context.tools,
      policyRequest: input.policy,
      async step(action) {
        if (!input.live && !action.toolCalls.length)
          return StepSchema.parse(await runtime.request({ op: "finish" }));
        return StepSchema.parse(
          await runtime.request({
            op: input.live ? "live_step" : "step",
            ...action,
          }),
        );
      },
      async terminate() {
        throw new Error(
          "Attempt exhausted its turn budget; no successful native outcome claimed",
        );
      },
    });
    return {
      schema: "openpond.tauInspectionAttempt.v1",
      taskId: input.taskId,
      upstreamRevision: revision,
      executionMode: input.live ? "live" : "controlled-fixture",
      ...result,
    };
  } finally {
    runtime.close();
  }
}

export function fireworksPolicy(): Policy {
  const base = process.env.OPENPOND_OPCHAT_BASE_URL;
  if (
    ![
      "https://staging-api.openpond.ai/opchat/v1",
      "https://api.openpond.ai/opchat/v1",
    ].includes(base ?? "")
  )
    throw new Error(
      "Set OPENPOND_OPCHAT_BASE_URL to the current OpChat endpoint",
    );
  const key = process.env.OPENPOND_API_KEY;
  if (!key) throw new Error("OPENPOND_API_KEY is required for live execution");
  return async (request, signal) => {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        tools: request.tools,
        temperature: 0,
        max_tokens: 2048,
      }),
    });
    if (!response.ok)
      throw new Error(`OpChat request failed (${response.status})`);
    const body = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({
                content: z.string().nullable().optional(),
                tool_calls: z
                  .array(
                    z.object({
                      id: z.string(),
                      function: z.object({
                        name: z.string(),
                        arguments: z.string(),
                      }),
                    }),
                  )
                  .optional(),
              }),
            }),
          )
          .min(1),
        usage: z.unknown().optional(),
      })
      .parse(await response.json());
    const message = body.choices[0]!.message;
    return {
      content: message.content ?? null,
      toolCalls: (message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: c.function.arguments,
      })),
      result: { model, usage: body.usage ?? null },
    };
  };
}
