// A pinned download checked whole: a HEAD cannot see a replaced asset. Shared by every upstream check holding a url and a sha256.
import { createHash } from 'node:crypto';

/** A download, retried: a 502 or a dropped connection says nothing about the pin. */
async function retrying(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (response.status < 500 || attempt === 4) return response;
    } catch (error) {
      if (attempt === 4) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

/** What is wrong with each of these pins, in words. Empty when every one downloads and matches. */
export async function brokenDownloads(pins) {
  const faults = await Promise.all(
    pins.map(async ({ url, sha256 }) => {
      const response = await retrying(url);
      if (!response.ok) return `${url} → HTTP ${response.status}`;
      const found = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
      return found === sha256 ? undefined : `${url} is sha256 ${found}, pinned ${sha256}`;
    }),
  );
  return faults.filter(Boolean);
}
