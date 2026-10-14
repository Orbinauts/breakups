/**
 * Downloads that survive a moment's trouble at the far end: a connection the
 * server closed while it idled, a dropped transfer or a busy reply is tried
 * again after a pause, and only the last failure is thrown.
 */

/** Times a fetch is tried before it fails. */
export const FETCH_ATTEMPTS = 3;

export const USER_AGENT = "breakups-archive (https://github.com/Orbinauts/breakups)";

/** One fetch of `url`, the response read through `attempt`, tried again on any failure up to `FETCH_ATTEMPTS` times, 5 s then 10 s apart. */
export async function retried<T>(url: string, attempt: () => Promise<T>): Promise<T> {
  for (let tried = 1; ; tried++) {
    try {
      return await attempt();
    } catch (error) {
      if (tried >= FETCH_ATTEMPTS) throw error;
      console.log(`${url}: ${(error as Error).message}; trying again (${tried + 1} of ${FETCH_ATTEMPTS})`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 5000 * tried));
    }
  }
}

/** A URL's text, a reply other than 2xx counted as a failure, tried again as `retried` does. */
export async function fetchText(url: string): Promise<string> {
  return retried(url, async () => {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.text();
  });
}
