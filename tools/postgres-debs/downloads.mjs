// A pinned download checked whole: a HEAD cannot see a replaced asset. Shared by every upstream check holding a url and a sha256.
import { createHash } from 'node:crypto';

/** Thrown when a download could not be completed at all: that is the network or the host, and says nothing about the pin. */
export class CouldNotTell extends Error {}

/**
 * A download, retried, BODY INCLUDED: a 502, a dropped connection or a body slower than the timeout says nothing about the
 * pin. The timeout covers the whole transfer, so the body is read inside the attempt, or a slow link would escape the
 * retry and read as a broken pin. Resolves to the status and the bytes; after the last attempt, throws CouldNotTell.
 */
async function retrying(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (response.status < 500 || attempt === 4) {
        return { status: response.status, ok: response.ok, body: response.ok ? Buffer.from(await response.arrayBuffer()) : null };
      }
    } catch (error) {
      if (attempt === 4) throw new CouldNotTell(`${url}: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

/** What is wrong with each of these pins, in words. Empty when every one downloads and matches. Throws CouldNotTell. */
export async function brokenDownloads(pins) {
  const faults = await Promise.all(
    pins.map(async ({ url, sha256 }) => {
      const response = await retrying(url);
      if (!response.ok) return `${url} → HTTP ${response.status}`;
      const found = createHash('sha256').update(response.body).digest('hex');
      return found === sha256 ? undefined : `${url} is sha256 ${found}, pinned ${sha256}`;
    }),
  );
  return faults.filter(Boolean);
}
