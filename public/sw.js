/* Market Time Machine production service worker. Keep runtime caching limited to
 * static, same-origin resources so future API responses or user data are never
 * persisted accidentally. Bump CACHE_VERSION when cache behavior or the
 * release-critical app shell changes. */
const CACHE_VERSION = "personal-decision-gym-v2-2";
const CACHE_PREFIX = "market-time-machine-";
const APP_SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${CACHE_VERSION}`;
const STATIC_DESTINATIONS = new Set([
  "font",
  "image",
  "manifest",
  "script",
  "style",
]);

function appUrl(relativePath = "./") {
  return new URL(relativePath, self.registration.scope);
}

function isCacheableResponse(response) {
  return response.ok && (response.type === "basic" || response.type === "default");
}

function isCanonicalAppShellResponse(requestUrl, response) {
  const shellUrl = appUrl();
  if (requestUrl.href !== shellUrl.href || !isCacheableResponse(response)) {
    return false;
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "text/html" || !response.url) return false;

  try {
    return new URL(response.url, shellUrl).href === shellUrl.href;
  } catch {
    return false;
  }
}

async function cacheResponse(cache, request, response) {
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function cacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  const shellUrl = appUrl();
  const shellResponse = await fetch(shellUrl, { cache: "reload" });
  if (!isCanonicalAppShellResponse(shellUrl, shellResponse)) {
    throw new Error(
      `Unable to cache canonical HTML app shell: HTTP ${shellResponse.status}`,
    );
  }

  await cache.put(shellUrl, shellResponse.clone());
  const html = await shellResponse.text();
  const optionalAssetUrls = new Set([
    appUrl("manifest.webmanifest").href,
    appUrl("icons/icon-192.png").href,
    appUrl("icons/icon-512.png").href,
    appUrl("icons/icon-maskable-512.png").href,
  ]);
  const criticalAssetUrls = new Set();
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/g;
  for (const match of html.matchAll(attributePattern)) {
    const candidate = new URL(match[1], shellUrl);
    if (
      candidate.origin === shellUrl.origin &&
      candidate.href.startsWith(self.registration.scope)
    ) {
      criticalAssetUrls.add(candidate.href);
      optionalAssetUrls.delete(candidate.href);
    }
  }

  await Promise.all(
    [...criticalAssetUrls].map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (!isCacheableResponse(response)) {
        throw new Error(
          `Unable to cache critical app asset ${url}: HTTP ${response.status}`,
        );
      }
      await cache.put(url, response.clone());
    }),
  );

  await Promise.all(
    [...optionalAssetUrls].map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        await cacheResponse(cache, url, response);
      } catch {
        // The app shell remains usable even if a manifest/icon cannot cache.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    cacheAppShell().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(CACHE_PREFIX) &&
                key !== APP_SHELL_CACHE &&
                key !== RUNTIME_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (
    requestUrl.origin !== self.location.origin ||
    !requestUrl.href.startsWith(self.registration.scope)
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (isCanonicalAppShellResponse(requestUrl, response)) {
            const cache = await caches.open(APP_SHELL_CACHE);
            await cache.put(appUrl(), response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(appUrl());
          return cached ?? Response.error();
        }),
    );
    return;
  }

  if (!STATIC_DESTINATIONS.has(request.destination)) return;

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      const cache = await caches.open(RUNTIME_CACHE);
      return cacheResponse(cache, request, response);
    }),
  );
});
