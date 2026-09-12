import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The declared profile runtime supplies pinned tau2 + data and Python dependencies.
// Missing runtime dependencies are execution errors, never a passing/zero grade.
export function verify(value) {
  if (!value?.expected?.task || !value?.evaluatorContext?.simulation)
    throw new Error(
      "Host-recorded native simulation and private task are required",
    );
  const result = spawnSync(
    "python3",
    [fileURLToPath(new URL("./verify.py", import.meta.url))],
    {
      input: JSON.stringify(value),
      encoding: "utf8",
      timeout: 25000,
      maxBuffer: 1048576,
      env: { ...process.env, PYTHON_DOTENV_DISABLED: "1" },
    },
  );
  if (result.error || result.status !== 0)
    throw new Error("Native tau evaluator failed");
  return JSON.parse(result.stdout);
}
