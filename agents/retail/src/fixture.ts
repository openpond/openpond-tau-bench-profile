import { z } from "zod";
import { inspectTask } from "./runtime.js";
import { runAttempt } from "./attempt.js";
/** Privileged reference actions are ONLY used by this explicit deterministic fixture. */
export async function fixture(
  taskId: string,
  correct: boolean,
  signal: AbortSignal,
) {
  const inspected = z
    .object({
      task: z.object({
        evaluation_criteria: z.object({
          actions: z.array(
            z.object({
              name: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            }),
          ),
        }),
      }),
    })
    .parse(await inspectTask(taskId, signal));
  const actions = correct ? inspected.task.evaluation_criteria.actions : [];
  let index = 0;
  return runAttempt({
    taskId,
    signal,
    live: false,
    maxTurns: Math.max(2, actions.length + 1),
    policy: async () => {
      const action = actions[index++];
      return {
        content: action ? null : "End controlled fixture.",
        toolCalls: action
          ? [
              {
                id: `fixture-${index}`,
                name: action.name,
                arguments: JSON.stringify(action.arguments),
              },
            ]
          : [],
        result: {
          source: "privileged-reference-fixture",
          notModelGenerated: true,
        },
      };
    },
  });
}
