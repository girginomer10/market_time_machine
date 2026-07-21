import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SERVICE_WORKER_PATH = resolve(process.cwd(), "public/sw.js");
const SCOPE = "https://example.test/market-time-machine/";

type FetchEvent = {
  request: {
    destination: string;
    method: string;
    mode: string;
    url: string;
  };
  respondWith(response: Promise<unknown>): void;
};

function mockResponse({
  contentType = "text/html; charset=utf-8",
  ok = true,
  status = 200,
  type = "basic",
  url = SCOPE,
} = {}) {
  const response = {
    headers: {
      get: vi.fn((name: string) =>
        name.toLowerCase() === "content-type" ? contentType : null,
      ),
    },
    ok,
    status,
    type,
    url,
    clone: vi.fn(),
  };
  response.clone.mockReturnValue(response);
  return response;
}

async function loadServiceWorker() {
  const source = await readFile(SERVICE_WORKER_PATH, "utf8");
  const listeners = new Map<string, (event: FetchEvent) => void>();
  const cache = { put: vi.fn(async () => undefined) };
  const caches = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => []),
    match: vi.fn(async () => undefined),
    open: vi.fn(async () => cache),
  };
  const fetchImpl = vi.fn();
  const responseError = vi.fn();
  const workerSelf = {
    addEventListener: vi.fn(
      (name: string, listener: (event: FetchEvent) => void) => {
        listeners.set(name, listener);
      },
    ),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: new URL(SCOPE).origin },
    registration: { scope: SCOPE },
    skipWaiting: vi.fn(async () => undefined),
  };

  runInNewContext(source, {
    Error,
    Promise,
    Response: { error: responseError },
    Set,
    URL,
    caches,
    fetch: fetchImpl,
    self: workerSelf,
  });

  const fetchListener = listeners.get("fetch");
  if (!fetchListener) throw new Error("Service worker did not register fetch.");

  async function navigate(url: string) {
    let responsePromise: Promise<unknown> | undefined;
    fetchListener({
      request: {
        destination: "document",
        method: "GET",
        mode: "navigate",
        url,
      },
      respondWith(response) {
        responsePromise = response;
      },
    });
    if (!responsePromise) {
      throw new Error("Navigation was not handled by the service worker.");
    }
    return responsePromise;
  }

  return { cache, caches, fetchImpl, navigate };
}

describe("production service worker navigation caching", () => {
  it("refreshes the app shell for a successful canonical scope-root HTML response", async () => {
    const worker = await loadServiceWorker();
    const response = mockResponse();
    worker.fetchImpl.mockResolvedValue(response);

    await expect(worker.navigate(SCOPE)).resolves.toBe(response);

    expect(worker.caches.open).toHaveBeenCalledTimes(1);
    expect(worker.cache.put).toHaveBeenCalledTimes(1);
    expect(worker.cache.put.mock.calls[0][0].href).toBe(SCOPE);
    expect(response.clone).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "manifest navigation",
      requestUrl: `${SCOPE}manifest.webmanifest`,
      response: mockResponse({
        contentType: "application/manifest+json",
        url: `${SCOPE}manifest.webmanifest`,
      }),
    },
    {
      name: "non-root HTML document",
      requestUrl: `${SCOPE}guide/`,
      response: mockResponse({ url: `${SCOPE}guide/` }),
    },
    {
      name: "canonical root JSON",
      requestUrl: SCOPE,
      response: mockResponse({ contentType: "application/json" }),
    },
    {
      name: "root navigation redirected to non-root HTML",
      requestUrl: SCOPE,
      response: mockResponse({ url: `${SCOPE}login/` }),
    },
    {
      name: "unsuccessful canonical HTML",
      requestUrl: SCOPE,
      response: mockResponse({ ok: false, status: 500 }),
    },
  ])("does not let $name replace the cached app shell", async ({
    requestUrl,
    response,
  }) => {
    const worker = await loadServiceWorker();
    worker.fetchImpl.mockResolvedValue(response);

    await expect(worker.navigate(requestUrl)).resolves.toBe(response);

    expect(worker.caches.open).not.toHaveBeenCalled();
    expect(worker.cache.put).not.toHaveBeenCalled();
    expect(response.clone).not.toHaveBeenCalled();
  });
});
