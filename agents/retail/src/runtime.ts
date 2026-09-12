import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const revision = "672227c6b6676edc20d57ea53b7000262aae77b9";
export const model = "accounts/fireworks/models/deepseek-v4-flash";
export const StepSchema = z.object({
  toolResults: z.array(
    z.object({ id: z.string(), name: z.string(), output: z.unknown() }),
  ),
  userMessage: z.string().nullable(),
  terminal: z.boolean(),
  grading: z.record(z.string(), z.unknown()).optional(),
  simulation: z.record(z.string(), z.unknown()).optional(),
  stateHash: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

/** One child per attempt; closing/killing it owns all Python thread cleanup. */
export class RetailRuntime {
  private child;
  private pending: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  } | null = null;
  private closed = false;
  private timer: ReturnType<typeof setTimeout>;
  private abort: () => void;
  constructor(
    private signal: AbortSignal,
    timeoutMs = 120_000,
  ) {
    this.child = spawn(
      path.join(root, ".venv/bin/python"),
      [path.join(root, "python/bridge.py")],
      {
        cwd: root,
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, PYTHON_DOTENV_DISABLED: "1" },
      },
    );
    let bytes = 0;
    this.child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 16 * 1024 * 1024)
        this.fail(new Error("τ runtime output limit exceeded"));
    });
    this.child.stdin.on("error", () =>
      this.fail(new Error("τ runtime input closed")),
    );
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      const pending = this.pending;
      this.pending = null;
      if (!pending) return;
      try {
        const value = z
          .object({
            ok: z.boolean(),
            result: z.unknown().optional(),
            error: z.string().optional(),
          })
          .parse(JSON.parse(line));
        if (!value.ok) pending.reject(new Error(`τ runtime: ${value.error}`));
        else pending.resolve(value.result);
      } catch {
        pending.reject(new Error("Invalid τ runtime response"));
        this.close();
      }
    });
    this.child.on("error", () =>
      this.fail(new Error("Unable to start τ runtime; run setup first")),
    );
    this.child.on("exit", () => this.fail(new Error("τ runtime exited")));
    this.abort = () => this.fail(new Error("τ attempt cancelled"));
    signal.addEventListener("abort", this.abort, { once: true });
    this.timer = setTimeout(
      () => this.fail(new Error("τ attempt deadline exceeded")),
      timeoutMs,
    );
    if (signal.aborted) this.abort();
  }
  private fail(error: Error) {
    this.pending?.reject(error);
    this.pending = null;
    this.close();
  }
  request(value: Record<string, unknown>): Promise<unknown> {
    if (this.closed || this.signal.aborted)
      return Promise.reject(new Error("τ runtime is closed"));
    if (this.pending)
      return Promise.reject(
        new Error("Concurrent τ operations are unsupported"),
      );
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.child.stdin.write(JSON.stringify(value) + "\n");
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.signal.removeEventListener("abort", this.abort);
    this.child.kill("SIGKILL");
    this.pending?.reject(new Error("τ runtime closed"));
    this.pending = null;
  }
}
export async function inspectTask(taskId: string, signal: AbortSignal) {
  const runtime = new RetailRuntime(signal);
  try {
    return await runtime.request({ op: "inspect", taskId });
  } finally {
    runtime.close();
  }
}
export async function catalog(signal: AbortSignal) {
  const runtime = new RetailRuntime(signal);
  try {
    return await runtime.request({ op: "catalog" });
  } finally {
    runtime.close();
  }
}
