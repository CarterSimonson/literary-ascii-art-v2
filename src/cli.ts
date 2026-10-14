#!/usr/bin/env bun
import { Command, CommanderError, InvalidArgumentError } from "commander";
import packageJson from "../package.json";
import { errorMessage, runIdeas } from "./ideas/run.ts";
import { requestSchema, titleToSlug } from "./ideas/schema.ts";
import { findBook, resolveBook } from "./books.ts";
import { runImages } from "./images/run.ts";
import { imagesRequestSchema } from "./images/schema.ts";

interface IdeasFlags {
  registry: string;
  author?: string;
  slug?: string;
  output: string;
  model?: string;
  timeout: number;
}

export interface CliOptions {
  run?: typeof runIdeas;
  images?: typeof runImages;
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
    .argument("<book>", "Registered book ID or legacy book title")
    .option("--registry <path>", "Book registry YAML", "books.yaml")
    .option(
      "--author <name>",
      "Author for literary context or ambiguous titles",
    )
    .option("--slug <slug>", "Override the book's output folder name")
    .option("--output <directory>", "Output root", "output")
    .option("--model <model>", "Override the configured Codex model")
    .option("--timeout <seconds>", "Codex request timeout", parseTimeout, 300)
    .action(async (title: string, flags: IdeasFlags): Promise<void> => {
      const registered = await findBook(title, flags.registry);
      if (!registered && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(title)) {
        throw new Error(
          `Unknown book ID '${title}'. Add it to ${flags.registry}`,
        );
      }
      if (
        registered &&
        (flags.author !== undefined || flags.slug !== undefined)
      ) {
        throw new Error(
          "Registered books get author and folder identity from the registry; omit --author and --slug",
        );
      }
      const request = requestSchema.parse({
        title: registered?.title ?? title,
        ...(registered
          ? { author: registered.author }
          : flags.author !== undefined
            ? { author: flags.author }
            : {}),
        slug: registered?.slug ?? flags.slug ?? titleToSlug(title),
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

  program
    .command("images")
    .description(
      "Generate and clean one transparent PNG per idea through Codex",
    )
    .argument("<book-id>", "Book ID in the registry")
    .option("--registry <path>", "Book registry YAML", "books.yaml")
    .option("--output <directory>", "Output root", "output")
    .option("--model <model>", "Override the configured Codex model")
    .option(
      "--timeout <seconds>",
      "Timeout per image attempt",
      parseTimeout,
      600,
    )
    .option(
      "--size <size>",
      "Requested native size: 1024x1536, 1536x1024, 1024x1024",
      "1024x1536",
    )
    .option(
      "--alpha-threshold <value>",
      "Alpha cutoff (1–255)",
      (value: string): number => {
        const threshold = Number(value);
        if (!Number.isInteger(threshold) || threshold < 1 || threshold > 255)
          throw new InvalidArgumentError(
            "Alpha threshold must be an integer from 1 to 255",
          );
        return threshold;
      },
      128,
    )
    .action(
      async (
        id: string,
        flags: {
          registry: string;
          output: string;
          model?: string;
          timeout: number;
          size: string;
          alphaThreshold: number;
        },
      ): Promise<void> => {
        const book = await resolveBook(id, flags.registry);
        const request = imagesRequestSchema.parse({
          ...book,
          outputRoot: flags.output,
          ...(flags.model ? { model: flags.model } : {}),
          timeoutSeconds: flags.timeout,
          size: flags.size,
          alphaThreshold: flags.alphaThreshold,
        });
        const path = await (options.images ?? runImages)(request, {
          ...(options.signal ? { signal: options.signal } : {}),
          onProgress: (message): void => {
            stderr(`${message}…\n`);
          },
        });
        stdout(`${path}\n`);
      },
    );

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
