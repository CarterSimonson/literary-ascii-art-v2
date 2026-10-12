import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli.ts";
import type { runIdeas } from "../src/ideas/run.ts";

describe("bookgen command interface", (): void => {
  test("passes book identity and explicit settings to the ideas stage", async (): Promise<void> => {
    let stdout = "";
    const run: typeof runIdeas = (request): Promise<string> => {
      expect(request).toEqual({
        title: "Les Misérables",
        author: "Victor Hugo",
        slug: "hugo-les-miserables",
        outputRoot: "custom-output",
        model: "chosen-model",
        timeoutSeconds: 60,
      });
      return Promise.resolve("/custom-output/hugo-les-miserables/ideas.yaml");
    };
    const code = await runCli(
      [
        "ideas",
        "Les Misérables",
        "--author",
        "Victor Hugo",
        "--slug",
        "hugo-les-miserables",
        "--output",
        "custom-output",
        "--model",
        "chosen-model",
        "--timeout",
        "60",
      ],
      {
        run,
        stdout: (message): void => {
          stdout += message;
        },
        stderr: (): void => {},
      },
    );
    expect(code).toBe(0);
    expect(stdout).toBe("/custom-output/hugo-les-miserables/ideas.yaml\n");
  });

  test("defaults to a title-derived folder, output root, and configured Codex model", async (): Promise<void> => {
    const run: typeof runIdeas = (request): Promise<string> => {
      expect(request).toEqual({
        title: "Dracula",
        slug: "dracula",
        outputRoot: "output",
        timeoutSeconds: 300,
      });
      return Promise.resolve("/output/dracula/ideas.yaml");
    };
    expect(
      await runCli(["ideas", "Dracula"], {
        run,
        stdout: (): void => {},
        stderr: (): void => {},
      }),
    ).toBe(0);
  });

  test.each([
    ["missing title", ["ideas"]],
    ["extra argument", ["ideas", "Dracula", "unexpected"]],
    ["unknown command", ["images", "Dracula"]],
    ["unknown flag", ["ideas", "Dracula", "--oops"]],
    ["blank title", ["ideas", "  "]],
    ["unsafe slug", ["ideas", "Dracula", "--slug", "../../outside"]],
    ["invalid timeout", ["ideas", "Dracula", "--timeout", "NaN"]],
    ["zero timeout", ["ideas", "Dracula", "--timeout", "0"]],
  ])("rejects %s without invoking Codex", async (_, args): Promise<void> => {
    let called = false;
    let stderr = "";
    const code = await runCli(args, {
      run: (): Promise<string> => {
        called = true;
        return Promise.resolve("unexpected");
      },
      stdout: (): void => {},
      stderr: (message): void => {
        stderr += message;
      },
    });
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(stderr.length).toBeGreaterThan(0);
  });

  test("reports a generation failure with a nonzero exit", async (): Promise<void> => {
    let stderr = "";
    const code = await runCli(["ideas", "Dracula"], {
      run: (): Promise<string> => {
        throw new Error(
          "Authentication required. Trace: /output/dracula/traces/ideas",
        );
      },
      stderr: (message): void => {
        stderr += message;
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Authentication required");
  });

  test("the executable displays help without authentication or generation", async (): Promise<void> => {
    const child = Bun.spawn(["bun", "src/cli.ts", "ideas", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(stdout).toContain("bookgen ideas");
    expect(stdout).toContain("--author");
  });
});
