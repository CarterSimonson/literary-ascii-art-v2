import { Codex } from "@openai/codex-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(".artifacts/smoke");
await mkdir(dir, { recursive: true });
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) =>
      v !== undefined &&
      !["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"].includes(k),
  ),
) as Record<string, string>;
const sdk = new Codex({
  env,
  config: { forced_login_method: "chatgpt", model_provider: "openai" },
});
const thread = sdk.startThread({
  workingDirectory: dir,
  skipGitRepoCheck: true,
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  webSearchMode: "disabled",
});
const { events } = await thread.runStreamed(
  "Use the built-in image generation tool exactly once to create a 2:3 portrait transparent PNG: a bold flat deep-blue sea mass with a broad sailboat cutout, purely pictorial, no lettering, no gradients, no mockup. Request transparent background. Do not call any paid image API or ask for credentials. Do not create substitute vector/code art. After the image tool completes, return only the generated PNG file path and whether generation succeeded. Do not modify any existing files.",
);
let log = "";
for await (const event of events) {
  log += JSON.stringify(event) + "\n";
  await writeFile(resolve(dir, "events.jsonl"), log);
  console.error(JSON.stringify(event));
}
console.log(JSON.stringify({ threadId: thread.id }));
