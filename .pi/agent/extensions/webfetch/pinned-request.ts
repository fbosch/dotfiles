import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

function responseHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
      continue;
    }
    if (value !== undefined) result.set(name, value);
  }
  return result;
}

export async function requestPinnedUrl(
  url: URL,
  addresses: readonly string[],
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  const address = addresses[0];
  if (address === undefined) throw new Error(`No validated address available for ${url.hostname}`);
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error(`Invalid resolved address: ${address}`);
  const records = addresses.map((candidate) => ({ address: candidate, family: isIP(candidate) }));
  if (records.some((record) => record.family !== 4 && record.family !== 6)) {
    throw new Error(`Invalid resolved address for ${url.hostname}`);
  }

  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: "GET",
        agent: false,
        headers: { ...headers, "Accept-Encoding": "identity", Connection: "close" },
        signal,
        lookup: (_hostname, options, callback) => {
          // TLS must finish attaching error listeners before a synchronous connect denial can occur.
          queueMicrotask(() => {
            if (typeof options === "object" && options.all === true) {
              callback(null, records);
              return;
            }
            callback(null, address, family);
          });
        },
      },
      (incoming) => {
        try {
          const status = incoming.statusCode ?? 500;
          const hasNoBody = status === 204 || status === 205 || status === 304;
          // SAFETY: IncomingMessage is a raw HTTP response stream and yields byte chunks.
          const body = hasNoBody
            ? null
            : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>);
          const statusText = incoming.statusMessage;
          resolve(
            new Response(body, {
              status,
              ...(statusText === undefined ? {} : { statusText }),
              headers: responseHeaders(incoming.headers),
            }),
          );
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}
