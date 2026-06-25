/**
 * OpenScout live-website verification.
 *
 * Google's `websiteURI` is often stale: the domain may have expired, the host
 * may be down, or the link may point at a dead landing page. Trusting it blindly
 * is the single biggest source of *missed* leads (a business whose site died is
 * exactly who needs a new one). This module checks, from the browser, whether a
 * listed site is actually reachable.
 *
 * It is intentionally 100% client-side: the user's browser contacts the target
 * site directly, the same as if they clicked the link. No third-party proxy, no
 * data leaves to a backend. CORS means we cannot read the response body, but we
 * can reliably tell "the server answered" from "the domain is dead" using two
 * independent probes:
 *
 *   1. A `no-cors` GET — resolves (opaque) when the server responds with *any*
 *      status, rejects with a TypeError on DNS / connection / TLS failure.
 *   2. A favicon <img> load — succeeds when the origin serves a decodable icon.
 *
 * A site is only called "dead" when a probe fails at the network level with no
 * positive signal from the other, so live-but-slow or icon-less sites are never
 * mislabelled. Inconclusive checks return "unknown" and never flip a lead.
 */
(function () {
  "use strict";

  const DEFAULT_TIMEOUT = 7000;
  const DEFAULT_CONCURRENCY = 6;

  // Pure decision table — exported for unit testing. Each input is one of
  // "ok" (responded), "fail" (network-level failure), "timeout" (no answer).
  function interpretProbes(fetchResult, faviconResult) {
    if (fetchResult === "ok" || faviconResult === "ok") {
      return { state: "live", probes: 1 };
    }
    const failed =
      (fetchResult === "fail" ? 1 : 0) + (faviconResult === "fail" ? 1 : 0);
    if (failed >= 1 && fetchResult !== "timeout") {
      return { state: "dead", probes: failed };
    }
    return { state: "unknown", probes: 0 };
  }

  function normalizeForProbe(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  }

  function probeFetch(url, timeout) {
    if (typeof fetch !== "function" || typeof AbortController === "undefined") {
      return Promise.resolve("timeout");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, {
      mode: "no-cors",
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(() => "ok")
      .catch((error) => (error && error.name === "AbortError" ? "timeout" : "fail"))
      .finally(() => clearTimeout(timer));
  }

  function probeFavicon(origin, timeout) {
    if (!origin || typeof Image === "undefined") {
      return Promise.resolve("timeout");
    }
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        img.onload = img.onerror = null;
        img.src = "";
        resolve(result);
      };
      const timer = setTimeout(() => done("timeout"), timeout);
      img.onload = () => {
        clearTimeout(timer);
        done("ok");
      };
      img.onerror = () => {
        clearTimeout(timer);
        done("fail");
      };
      img.referrerPolicy = "no-referrer";
      img.src = `${origin}/favicon.ico?openscout=${Date.now()}`;
    });
  }

  async function verifySite(rawUrl, options = {}) {
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const url = normalizeForProbe(rawUrl);
    if (!url) {
      return { state: "unknown", probes: 0 };
    }
    const origin = originOf(url);
    const [fetchResult, faviconResult] = await Promise.all([
      probeFetch(url, timeout),
      probeFavicon(origin, timeout),
    ]);
    return interpretProbes(fetchResult, faviconResult);
  }

  /**
   * Verify many URLs with bounded concurrency.
   * @param items array of { id, url } — only entries with a url are probed.
   * @returns Map<id, { state, probes }>
   */
  async function verifyMany(items, options = {}) {
    const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    const results = new Map();
    const targets = items.filter((item) => item && item.url);
    let index = 0;
    let completed = 0;

    const runners = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (index < targets.length) {
        const item = targets[index];
        index += 1;
        try {
          results.set(item.id, await verifySite(item.url, options));
        } catch {
          results.set(item.id, { state: "unknown", probes: 0 });
        }
        completed += 1;
        if (typeof options.onProgress === "function") {
          options.onProgress({ completed, total: targets.length });
        }
      }
    });

    await Promise.all(runners);
    return results;
  }

  const api = { verifySite, verifyMany, interpretProbes, normalizeForProbe };

  if (typeof window !== "undefined") {
    window.OpenScout = window.OpenScout || {};
    window.OpenScout.verify = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
