/**
 * OpenScout live-website verification — "the web info" check.
 *
 * Google's `websiteURI` is often stale: the domain may have expired, the host
 * may be down, or only one of http/https/www variants may answer. Trusting it
 * blindly is the single biggest source of *missed* leads (a business whose site
 * died is exactly who needs a new one). This module checks, from the browser,
 * whether a listed site is actually reachable.
 *
 * It is intentionally 100% client-side: the user's browser contacts the target
 * site directly, the same as if they clicked the link. No third-party proxy, no
 * data leaves to a backend. CORS means we cannot read the response body, but we
 * can reliably tell "the server answered" from "the domain is dead" using two
 * kinds of probe across several endpoint variants:
 *
 *   1. A `no-cors` GET — resolves (opaque) when the server responds with *any*
 *      status, rejects with a TypeError on DNS / connection / TLS failure.
 *   2. An icon <img> load — succeeds when the origin serves a decodable image.
 *
 * Robustness comes from breadth: we try https + http and apex + www, plus a few
 * common icon paths. A single ok signal anywhere => live. We only call a site
 * "dead" when *every* connection attempt failed at the network level with no
 * positive signal at all, so live-but-slow, https-only or icon-less sites are
 * never mislabelled. Anything ambiguous stays "unknown" and never flips a lead.
 */
(function () {
  "use strict";

  const DEFAULT_TIMEOUT = 7000;
  const DEFAULT_CONCURRENCY = 6;
  const ICON_PATHS = ["/favicon.ico", "/apple-touch-icon.png"];

  // ---------------------------------------------------------------------------
  // Pure decision logic (exported for unit testing)
  // ---------------------------------------------------------------------------

  /**
   * Back-compatible two-signal decision (one fetch + one favicon). Kept for the
   * existing test-suite and simple callers.
   */
  function interpretProbes(fetchResult, faviconResult) {
    return summarize({
      fetch: [fetchResult],
      favicon: [faviconResult],
    });
  }

  /**
   * Reduce many probe results into a single verdict.
   * @param {{fetch:string[], favicon:string[]}} signals  each entry is
   *        "ok" (responded), "fail" (network-level failure) or "timeout".
   * @returns {{state:"live"|"dead"|"unknown", probes:number}}
   */
  function summarize(signals) {
    const fetchResults = signals.fetch || [];
    const faviconResults = signals.favicon || [];
    const all = [...fetchResults, ...faviconResults];

    const okCount = all.filter((r) => r === "ok").length;
    if (okCount > 0) {
      return { state: "live", probes: okCount };
    }

    // "Dead" requires that we actually reached the network layer and it refused
    // us everywhere: at least one hard fetch failure, and no fetch attempt left
    // hanging (a timeout could just be a slow server, so it blocks a dead call).
    const fetchFails = fetchResults.filter((r) => r === "fail").length;
    const fetchTimeouts = fetchResults.filter((r) => r === "timeout").length;
    const faviconFails = faviconResults.filter((r) => r === "fail").length;

    if (fetchFails > 0 && fetchTimeouts === 0) {
      return { state: "dead", probes: fetchFails + faviconFails };
    }

    return { state: "unknown", probes: 0 };
  }

  function normalizeForProbe(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
  }

  // Build the endpoint variants to probe for a URL: the given one first, then
  // the alternate scheme and the apex/www counterpart, de-duplicated. Breadth
  // here is what rescues sites that only answer on one variant.
  function endpointVariants(rawUrl) {
    const normalized = normalizeForProbe(rawUrl);
    if (!normalized) return [];
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch {
      return [normalized];
    }

    const host = parsed.hostname.replace(/^www\./i, "");
    const hosts = [host, `www.${host}`];
    const schemes = parsed.protocol === "http:" ? ["http:", "https:"] : ["https:", "http:"];
    const variants = [];
    schemes.forEach((scheme) => {
      hosts.forEach((h) => {
        const origin = `${scheme}//${h}`;
        if (!variants.includes(origin)) variants.push(origin);
      });
    });
    return variants;
  }

  // ---------------------------------------------------------------------------
  // Browser probes
  // ---------------------------------------------------------------------------
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

  function probeIcon(iconUrl, timeout) {
    if (!iconUrl || typeof Image === "undefined") {
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
      img.src = `${iconUrl}?openscout=${Date.now()}`;
    });
  }

  // Resolve as soon as any probe says "ok" so a live site short-circuits fast,
  // but still collect every result if none succeed (needed to declare "dead").
  function raceForLive(promises) {
    return new Promise((resolve) => {
      let remaining = promises.length;
      const results = [];
      if (!remaining) {
        resolve([]);
        return;
      }
      const handle = (result) => {
        results.push(result);
        remaining -= 1;
        if (result === "ok") {
          resolve(["ok"]); // resolve is idempotent; first ok wins
        } else if (remaining === 0) {
          resolve(results);
        }
      };
      // Probes resolve to "ok"/"fail"/"timeout" and never reject, but treat any
      // unexpected rejection as a failed probe so a scan can never hang here.
      promises.forEach((promise) => promise.then(handle, () => handle("fail")));
    });
  }

  async function verifySite(rawUrl, options = {}) {
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const variants = endpointVariants(rawUrl);
    if (!variants.length) {
      return { state: "unknown", probes: 0 };
    }

    // Round 1: probe the primary variant (fetch + icons) and a fetch on the
    // alternate scheme of the same host in parallel. A single "ok" ends it.
    const primary = variants[0];
    const round1Fetches = [probeFetch(primary, timeout)];
    if (variants[1]) round1Fetches.push(probeFetch(variants[1], timeout));
    const round1Icons = ICON_PATHS.map((path) => probeIcon(`${primary}${path}`, timeout));

    const fetchResults = await raceForLive(round1Fetches);
    if (fetchResults.includes("ok")) {
      return { state: "live", probes: 1 };
    }
    const iconResults = await raceForLive(round1Icons);
    if (iconResults.includes("ok")) {
      return { state: "live", probes: 1 };
    }

    // Round 2: if nothing answered, widen to the www/apex counterparts before
    // concluding. Only run the variants we have not already hit.
    const tried = new Set([primary, variants[1]].filter(Boolean));
    const extraFetches = variants.filter((v) => !tried.has(v)).map((v) => probeFetch(v, timeout));
    const extraIcons = variants[1] ? [probeIcon(`${variants[1]}${ICON_PATHS[0]}`, timeout)] : [];
    const extraFetchResults = extraFetches.length ? await raceForLive(extraFetches) : [];
    if (extraFetchResults.includes("ok")) {
      return { state: "live", probes: 1 };
    }
    const extraIconResults = extraIcons.length ? await raceForLive(extraIcons) : [];

    return summarize({
      fetch: [...fetchResults, ...extraFetchResults],
      favicon: [...iconResults, ...extraIconResults],
    });
  }

  /**
   * Verify many URLs with bounded concurrency and per-origin caching (the same
   * domain often appears across listings; we only hit it once).
   * @param items array of { id, url } — only entries with a url are probed.
   * @returns Map<id, { state, probes }>
   */
  async function verifyMany(items, options = {}) {
    const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    const results = new Map();
    const cache = new Map();
    const targets = (items || []).filter((item) => item && item.url);
    let index = 0;
    let completed = 0;

    const runners = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (index < targets.length) {
        const item = targets[index];
        index += 1;
        const cacheKey = cacheKeyFor(item.url);
        try {
          if (cacheKey && cache.has(cacheKey)) {
            results.set(item.id, cache.get(cacheKey));
          } else {
            const verdict = await verifySite(item.url, options);
            if (cacheKey) cache.set(cacheKey, verdict);
            results.set(item.id, verdict);
          }
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

  function cacheKeyFor(rawUrl) {
    try {
      return new URL(normalizeForProbe(rawUrl)).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  }

  const api = {
    verifySite,
    verifyMany,
    interpretProbes,
    summarize,
    normalizeForProbe,
    endpointVariants,
  };

  if (typeof window !== "undefined") {
    window.OpenScout = window.OpenScout || {};
    window.OpenScout.verify = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
