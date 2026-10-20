#!/usr/bin/env bun
import { Command, CommanderError, InvalidArgumentError } from "commander";
import packageJson from "../package.json";
import { errorMessage, runIdeas } from "./ideas/run.ts";
import {
  DEFAULT_IDEA_COUNT,
  MAX_IDEA_COUNT,
  requestSchema,
  titleToSlug,
} from "./ideas/schema.ts";
import { findBook, resolveBook } from "./books.ts";
import { runImages } from "./images/run.ts";
import { runReclean } from "./images/reclean.ts";
import { imagesRequestSchema } from "./images/schema.ts";
import type { FetchRequest } from "./fetch/schema.ts";
import { runFetch, type FetchOptions } from "./fetch/run.ts";
import { runRender } from "./render/run.ts";
import { renderRequestSchema } from "./render/input.ts";
import {
  DEFAULT_SEPARATION_RADIUS,
  MAX_SEPARATION_RADIUS,
} from "./render/convert.ts";
import { runRound } from "./evals/round.ts";
import { startPortal } from "./evals/serve.ts";

interface GenerationFlags {
  registry: string;
  output: string;
  model?: string;
  timeout: number;
}

interface IdeasFlags extends GenerationFlags {
  author?: string;
  slug?: string;
  count: number;
}

interface FetchFlags extends GenerationFlags {
  editionContext?: string;
}

export interface CliOptions {
  run?: typeof runIdeas;
  images?: typeof runImages;
  reclean?: typeof runReclean;
  fetchBook?: typeof runFetch;
  render?: typeof runRender;
  round?: typeof runRound;
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

function parseSeparation(value: string): number {
  const radius = Number(value);

  if (
    !Number.isInteger(radius) ||
    radius < 0 ||
    radius > MAX_SEPARATION_RADIUS
  ) {
    throw new InvalidArgumentError(
      `Separation must be an integer from 0 to ${String(MAX_SEPARATION_RADIUS)}`,
    );
  }

  return radius;
}

function parsePositiveInteger(value: string, maximum: number): number {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new InvalidArgumentError(
      `Must be an integer from 1 to ${String(maximum)}`,
    );
  }

  return number;
}

function parseIdeaCount(value: string): number {
  const count = Number(value);

  if (!Number.isInteger(count) || count < 1 || count > MAX_IDEA_COUNT) {
    throw new InvalidArgumentError(
      `Count must be an integer from 1 to ${String(MAX_IDEA_COUNT)}`,
    );
  }

  return count;
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
    .command("fetch")
    .description(
      "Fetch Gutenberg text and identify non-book sections through Codex",
    )
    .argument("<book-id>", "Book ID in the registry")
    .option("--registry <path>", "Book registry YAML", "books.yaml")
    .option("--output <directory>", "Output root", "output")
    .option("--model <model>", "Override the configured Codex model")
    .option(
      "--edition-context <text>",
      "Known edition limitations for cleanup review and provenance",
    )
    .option(
      "--timeout <seconds>",
      "Download and cleanup timeout",
      parseTimeout,
      300,
    )
    .action(async (id: string, flags: FetchFlags): Promise<void> => {
      const book = await resolveBook(id, flags.registry);
      const request: FetchRequest = {
        ...book,
        outputRoot: flags.output,
        timeoutSeconds: flags.timeout,
      };

      if (flags.model) {
        request.model = flags.model;
      }

      if (flags.editionContext !== undefined) {
        request.editionContext = flags.editionContext;
      }

      const fetchOptions: FetchOptions = {
        onProgress: (message): void => {
          stderr(`${message}…\n`);
        },
      };

      if (options.signal) {
        fetchOptions.signal = options.signal;
      }

      const fetchBook = options.fetchBook ?? runFetch;
      const path = await fetchBook(request, fetchOptions);
      stdout(`${path}\n`);
    });

  program
    .command("ideas")
    .description("Generate original poster composition ideas through Codex")
    .argument("<book>", "Registered book ID or legacy book title")
    .option("--registry <path>", "Book registry YAML", "books.yaml")
    .option(
      "--author <name>",
      "Author for literary context or ambiguous titles",
    )
    .option("--slug <slug>", "Override the book's output folder name")
    .option("--output <directory>", "Output root", "output")
    .option("--model <model>", "Override gpt-6.1-sol (reasoning effort: high)")
    .option("--timeout <seconds>", "Codex request timeout", parseTimeout, 300)
    .option(
      "--count <number>",
      `Number of ideas (1–${String(MAX_IDEA_COUNT)})`,
      parseIdeaCount,
      DEFAULT_IDEA_COUNT,
    )
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
      const author = registered?.author ?? flags.author;

      const request = requestSchema.parse({
        title: registered?.title ?? title,
        ...(author !== undefined ? { author } : {}),
        slug: registered?.slug ?? flags.slug ?? titleToSlug(title),
        outputRoot: flags.output,
        ...(flags.model !== undefined ? { model: flags.model } : {}),
        timeoutSeconds: flags.timeout,
        ideaCount: flags.count,
      });
      stderr(
        `Generating ${String(request.ideaCount)} composition ideas for ${request.title}…\n`,
      );
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
    .option("--model <model>", "Override gpt-6.1-sol (reasoning effort: high)")
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
        if (!Number.isInteger(threshold) || threshold < 1 || threshold > 255) {
          throw new InvalidArgumentError(
            "Alpha threshold must be an integer from 1 to 255",
          );
        }
        return threshold;
      },
      128,
    )
    .option(
      "--reclean",
      "Reprocess the traced native images with current cleanup; no generation",
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
          reclean?: boolean;
        },
      ): Promise<void> => {
        const book = await resolveBook(id, flags.registry);
        const request = imagesRequestSchema.parse({
          title: book.title,
          author: book.author,
          slug: book.slug,
          outputRoot: flags.output,
          ...(flags.model ? { model: flags.model } : {}),
          timeoutSeconds: flags.timeout,
          size: flags.size,
          alphaThreshold: flags.alphaThreshold,
        });
        const runOptions = {
          ...(options.signal ? { signal: options.signal } : {}),
          onProgress: (message: string): void => {
            stderr(`${message}…\n`);
          },
        };

        let path: string;

        if (flags.reclean === true) {
          path = await (options.reclean ?? runReclean)(request, runOptions);
        } else {
          path = await (options.images ?? runImages)(request, runOptions);
        }

        stdout(`${path}\n`);
      },
    );

  program
    .command("render")
    .description(
      "Render a selected idea as printable character art for all output targets",
    )
    .argument("<book-id>", "Book ID in the registry")
    .requiredOption("--idea <idea-id>", "Selected generated artwork")
    .option(
      "--target <target-id>",
      "Render only this target (default: all targets)",
    )
    .option("--registry <path>", "Book registry YAML", "books.yaml")
    .option(
      "--targets <path>",
      "Output target registry YAML",
      "output-targets.yaml",
    )
    .option("--output <directory>", "Output root", "output")
    .option(
      "--background <hex>",
      "Poster background color (#RRGGBB)",
      "#FFFFFF",
    )
    .option(
      "--separation <cells>",
      `Empty cells left between differently colored regions (0–${String(MAX_SEPARATION_RADIUS)})`,
      parseSeparation,
      DEFAULT_SEPARATION_RADIUS,
    )
    .action(
      async (
        id: string,
        flags: {
          idea: string;
          target?: string;
          registry: string;
          targets: string;
          output: string;
          background: string;
          separation: number;
        },
      ): Promise<void> => {
        const book = await resolveBook(id, flags.registry);
        const request = renderRequestSchema.parse({
          ...book,
          idea: flags.idea,
          target: flags.target,
          targetRegistry: flags.targets,
          outputRoot: flags.output,
          background: flags.background,
          separation: flags.separation,
        });
        const paths = await (options.render ?? runRender)(request, {
          ...(options.signal ? { signal: options.signal } : {}),
          onProgress: (message): void => {
            stderr(`${message}…\n`);
          },
        });

        for (const path of paths) {
          stdout(`${path}\n`);
        }
      },
    );

  const evals = program
    .command("eval")
    .description("Run and review image-prompt evaluation rounds");

  evals
    .command("run")
    .description(
      "Generate, render, and score every prompt × suite idea; reruns fill in missing or failed images",
    )
    .argument("<round-id>", "Round ID, e.g. round-1")
    .option(
      "--prompts <directory>",
      "Create the round from *.prompt.md templates (and notes.md) in this directory",
    )
    .option("--retry <image...>", "Regenerate <prompt>/<book>/<idea> images")
    .option(
      "--concurrency <count>",
      "Images generated at once",
      (value: string): number => parsePositiveInteger(value, 8),
      3,
    )
    .option(
      "--timeout <seconds>",
      "Timeout per image attempt",
      parseTimeout,
      600,
    )
    .option("--registry <path>", "Book registry YAML", "books.yaml")
    .option("--output <directory>", "Output root", "output")
    .action(
      async (
        roundId: string,
        flags: {
          prompts?: string;
          retry?: string[];
          concurrency: number;
          timeout: number;
          registry: string;
          output: string;
        },
      ): Promise<void> => {
        const summary = await (options.round ?? runRound)({
          roundId,
          outputRoot: flags.output,
          registryPath: flags.registry,
          concurrency: flags.concurrency,
          timeoutSeconds: flags.timeout,
          ...(flags.prompts ? { promptsDirectory: flags.prompts } : {}),
          ...(flags.retry ? { retry: flags.retry } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          onProgress: (message: string): void => {
            stderr(`${message}\n`);
          },
        });

        stderr(
          `${String(summary.done)} done, ${String(summary.failed)} failed, ${String(summary.skipped)} already done\n`,
        );
        stdout(`${summary.directory}\n`);

        if (summary.failed > 0) {
          throw new Error(
            "Some images failed; rerun the same command to retry them",
          );
        }
      },
    );

  evals
    .command("serve")
    .description(
      "Open the local rating page; it can also write and run the next round",
    )
    .option(
      "--port <port>",
      "Port on 127.0.0.1",
      (value: string): number => parsePositiveInteger(value, 65535),
      4317,
    )
    .option(
      "--concurrency <count>",
      "Images generated at once for rounds started from the page",
      (value: string): number => parsePositiveInteger(value, 8),
      3,
    )
    .option(
      "--timeout <seconds>",
      "Timeout per image attempt",
      parseTimeout,
      900,
    )
    .option("--registry <path>", "Book registry YAML", "books.yaml")
    .option("--output <directory>", "Output root", "output")
    .action(
      async (flags: {
        port: number;
        concurrency: number;
        timeout: number;
        registry: string;
        output: string;
      }): Promise<void> => {
        const { server, jobs } = startPortal({
          outputRoot: flags.output,
          port: flags.port,
          registryPath: flags.registry,
          concurrency: flags.concurrency,
          timeoutSeconds: flags.timeout,
        });
        stdout(`Rating page: http://127.0.0.1:${String(server.port)}/\n`);

        // Serve until interrupted.
        await new Promise<void>((resolveStop) => {
          options.signal?.addEventListener("abort", () => {
            void server.stop();
            resolveStop();
          });
        });

        if (jobs.status().busy) {
          stderr("Stopped while a job was running; resume it from the page\n");
        }
      },
    );

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
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
