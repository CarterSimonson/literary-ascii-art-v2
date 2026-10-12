#!/usr/bin/env bun
import { Command, CommanderError, InvalidArgumentError } from "commander";
import packageJson from "../package.json";
import { errorMessage, runIdeas } from "./ideas/run.ts";
import { requestSchema, titleToSlug } from "./ideas/schema.ts";

interface IdeasFlags {
  author?: string;
  slug?: string;
  output: string;
  model?: string;
  timeout: number;
}

export interface CliOptions {
  run?: typeof runIdeas;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  signal?: AbortSignal;
}

function parseTimeout(value: string): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new InvalidArgumentError(
      "Timeout must be an integer from 1 to 3600 seconds",
    );
  }
  return seconds;
}

export async function runCli(
  argv: string[],
  options: CliOptions = {},
): Promise<number> {
  const stdout =
    options.stdout ??
    ((message: string): void => {
      process.stdout.write(message);
    });
  const stderr =
    options.stderr ??
    ((message: string): void => {
      process.stderr.write(message);
    });
  const program = new Command()
    .name("bookgen")
    .description(
      "Generate literary character-art posters, one pipeline step at a time",
    )
    .version(packageJson.version)
    .exitOverride()
    .configureOutput({ writeOut: stdout, writeErr: stderr });

  program
    .command("ideas")
    .description("Generate ten original poster composition ideas through Codex")
    .argument("<book>", "Book title (quote titles containing spaces)")
    .option(
      "--author <name>",
      "Author for literary context or ambiguous titles",
    )
    .option("--slug <slug>", "Override the book's output folder name")
    .option("--output <directory>", "Output root", "output")
    .option("--model <model>", "Override the configured Codex model")
    .option("--timeout <seconds>", "Codex request timeout", parseTimeout, 300)
    .action(async (title: string, flags: IdeasFlags): Promise<void> => {
      const request = requestSchema.parse({
        title,
        ...(flags.author !== undefined ? { author: flags.author } : {}),
        slug: flags.slug ?? titleToSlug(title),
        outputRoot: flags.output,
        ...(flags.model !== undefined ? { model: flags.model } : {}),
        timeoutSeconds: flags.timeout,
      });
      stderr(`Generating ten composition ideas for ${request.title}…\n`);
      const run = options.run ?? runIdeas;
      const path = await run(
        request,
        options.signal ? { signal: options.signal } : {},
      );
      stdout(`${path}\n`);
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    stderr(`bookgen: ${errorMessage(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const interrupt = (): void => {
    controller.abort(new Error("Interrupted"));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  process.exitCode = await runCli(process.argv.slice(2), {
    signal: controller.signal,
  });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
