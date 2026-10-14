export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export interface DownloadedBook {
  bytes: Buffer;
  url: string;
}

export type FetchTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export async function downloadBook(
  gutenbergId: number,
  signal: AbortSignal,
  transport: FetchTransport = fetch,
): Promise<DownloadedBook> {
  const url = `https://www.gutenberg.org/cache/epub/${String(gutenbergId)}/pg${String(gutenbergId)}.txt`;
  signal.throwIfAborted();

  const response = await transport(url, {
    signal,
    redirect: "error",
    headers: {
      "User-Agent": "bookgen/0.1 (single-book text download)",
      Accept: "text/plain",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Gutenberg download returned HTTP ${String(response.status)} for ${url}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/^text\/plain(?:;|$)/i.test(contentType)) {
    throw new Error("Gutenberg did not return plain text");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_SOURCE_BYTES) {
    throw new Error("Gutenberg source exceeds 20 MiB");
  }

  if (!response.body) {
    throw new Error("Gutenberg returned an empty response");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    let chunk = await reader.read();

    while (!chunk.done) {
      signal.throwIfAborted();
      receivedBytes += chunk.value.length;

      // Content-Length may be absent or inaccurate, so bound the streamed bytes too.
      if (receivedBytes > MAX_SOURCE_BYTES) {
        throw new Error("Gutenberg source exceeds 20 MiB");
      }

      chunks.push(chunk.value);
      chunk = await reader.read();
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  signal.throwIfAborted();
  return { bytes: Buffer.concat(chunks), url };
}
