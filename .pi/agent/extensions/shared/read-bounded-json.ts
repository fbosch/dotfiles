const MAX_RESPONSE_BYTES = 1024 * 1024;

export async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("response is too large");
  }
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response is too large");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  try {
    return JSON.parse(chunks.join(""));
  } catch (error) {
    // Preserve JSON.parse's native exception identity for callers.
    if (error instanceof SyntaxError) throw error;
    throw error;
  }
}
