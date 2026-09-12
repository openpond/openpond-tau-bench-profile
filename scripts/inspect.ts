import { mkdir, writeFile } from "node:fs/promises";
import { catalog, inspectTask, root } from "../agents/retail/src/runtime.js";
import { fixture } from "../agents/retail/src/fixture.js";
import { runAttempt, fireworksPolicy } from "../agents/retail/src/attempt.js";
import path from "node:path";
const [command = "catalog", taskId = "33"] = process.argv.slice(2);
const signal = AbortSignal.timeout(180_000);
let result: unknown;
if (command === "catalog") result = await catalog(signal);
else if (command === "inspect") result = await inspectTask(taskId, signal);
else if (command === "demo")
  result = {
    positive: await fixture(taskId, true, signal),
    negative: await fixture(taskId, false, signal),
  };
else if (command === "run")
  result = await runAttempt({
    taskId,
    signal,
    live: true,
    policy: fireworksPolicy(),
  });
else
  throw new Error(
    "Commands: catalog, inspect TASK_ID, demo TASK_ID, run TASK_ID",
  );
const output = path.join(root, "artifacts", `${command}-${Date.now()}.json`);
await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(output);
