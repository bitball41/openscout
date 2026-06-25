/**
 * OpenScout website classifier.
 *
 * This is the accuracy core of OpenScout. Given the web presence Google Places
 * reports for a business, it decides whether the business is a real lead (no
 * website of its own) and — just as importantly — how *confident* we are in that
 * call. Confidence is what lets the app report an honest "estimated mistake
 * rate" and filter out the guesses it is least sure about.
 *
 * The module is dependency-free and runs in the browser (attaches to
 * window.OpenScout.classify) and in Node (module.exports) so the pure logic can
 * be unit-tested.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Domain intelligence
  //
  // Each entry maps a set of host patterns to a category + human label. Matching
  // is by exact host or by ".suffix" so subdomains are caught (e.g. a match on
  // "facebook.com" also catches "m.facebook.com"). Builder entries deliberately
  // list only the *free subdomain* forms (e.g. "wixsite.com") — a business on a
  // custom domain hosted by Wix is indistinguishable from any other real site
  // and is correctly treated as "has a website".
  // ---------------------------------------------------------------------------
  const CATEGORY_TABLE = [
    {
      category: "social",
      label: "Social page only",
      confidence: 0.95,
      domains: [
        "facebook.com", "fb.com", "fb.me", "fb.watch",
        "instagram.com", "instagr.am",
        "tiktok.com",
        "twitter.com", "x.com", "t.co",
        "youtube.com", "youtu.be",
        "pinterest.com", "pin.it",
        "snapchat.com",
        "threads.net",
        "linkedin.com", "lnkd.in",
        "vk.com",
        "t.me", "telegram.me",
        "wa.me", "whatsapp.com",
        "m.me",
      ],
    },
    {
      category: "linkbio",
      label: "Link-in-bio page only",
      confidence: 0.95,
      domains: [
        "linktr.ee", "linktree.com",
        "beacons.ai", "beacons.page",
        "linkin.bio", "lnk.bio", "bio.link", "bio.site",
        "taplink.cc", "taplink.ws", "taplink.at",
        "msha.ke", "milkshake.app",
        "campsite.bio", "solo.to", "koji.to",
        "about.me", "hoo.be", "flow.page",
        "snipfeed.co", "stan.store", "shorby.com",
        "tap.bio", "contactin.bio", "allmylinks.com", "direct.me",
      ],
    },
    {
      category: "directory",
      label: "Directory listing only",
      confidence: 0.93,
      domains: [
        "yelp.com", "yelp.to",
        "tripadvisor.com", "tripadvisor.co.uk",
        "foursquare.com", "swarmapp.com",
        "yellowpages.com", "yp.com", "yellowpages.ca",
        "manta.com", "bbb.org",
        "angi.com", "angieslist.com", "thumbtack.com",
        "homeadvisor.com", "houzz.com", "porch.com", "buildzoom.com",
        "nextdoor.com", "citysearch.com", "superpages.com",
        "dexknows.com", "hotfrog.com", "brownbook.net",
        "chamberofcommerce.com", "merchantcircle.com",
        "mapquest.com", "cylex.us.com", "opendi.us",
        "expertise.com", "trustpilot.com",
        "healthgrades.com", "zocdoc.com", "vitals.com", "wellness.com",
        "ratemds.com", "webmd.com",
        "avvo.com", "justia.com", "findlaw.com", "lawyers.com",
        "zillow.com", "realtor.com", "trulia.com", "redfin.com",
        "weddingwire.com", "theknot.com", "bark.com",
      ],
    },
    {
      category: "booking",
      label: "Booking page only",
      confidence: 0.92,
      domains: [
        "vagaro.com", "booksy.com", "styleseat.com", "schedulicity.com",
        "mindbodyonline.com", "mindbody.io", "fresha.com",
        "squareup.com", "setmore.com", "acuityscheduling.com",
        "simplybook.me", "getsquire.com", "glossgenius.com",
        "calendly.com", "noterro.com", "janeapp.com", "timetap.com",
        "appointy.com", "genbook.com", "schedulista.com",
      ],
    },
    {
      category: "ordering",
      label: "Ordering page only",
      confidence: 0.9,
      domains: [
        "doordash.com", "ubereats.com", "grubhub.com", "postmates.com",
        "seamless.com", "chownow.com", "toasttab.com", "order.online",
        "clover.com", "opentable.com", "resy.com", "exploretock.com",
        "slicelife.com", "beyondmenu.com", "menufy.com", "ezcater.com",
        "spoton.com", "popmenu.com", "allset.com",
      ],
    },
    {
      category: "marketplace",
      label: "Marketplace storefront only",
      confidence: 0.88,
      domains: [
        "etsy.com", "ebay.com", "mercari.com", "depop.com",
        "poshmark.com", "faire.com", "bigcartel.com",
        "storenvy.com", "ecwid.com",
      ],
    },
    {
      category: "gmb",
      label: "Google profile only",
      confidence: 0.95,
      domains: [
        "g.page", "business.google.com", "goo.gl", "maps.app.goo.gl",
        "maps.google.com", "page.link",
      ],
    },
    {
      category: "builder",
      label: "Free site-builder page",
      confidence: 0.93,
      // Free-subdomain forms only — these signal a business that never bought a
      // domain. Custom domains on the same platforms read as real sites.
      domains: [
        "business.site", "sites.google.com",
        "godaddysites.com",
        "wixsite.com", "editorx.io",
        "weebly.com", "weeblysite.com",
        "square.site",
        "squarespace.com",
        "wordpress.com",
        "blogspot.com",
        "webnode.com", "webnode.page",
        "jimdosite.com", "jimdo.com",
        "strikingly.com", "mystrikingly.com",
        "webador.com", "website2.me", "simplesite.com",
        "ucraft.net", "tilda.ws", "carrd.co",
        "netlify.app", "vercel.app", "github.io", "pages.dev",
        "myshopify.com", "company.site", "shopsettings.com",
        "glideapp.io", "softr.app", "durable.co",
      ],
    },
  ];

  // Flatten the table into a single lookup keyed by host pattern for O(1)-ish
  // matching, while keeping the richer entry for labels/confidence.
  const DOMAIN_INDEX = new Map();
  CATEGORY_TABLE.forEach((entry) => {
    entry.domains.forEach((domain) => {
      DOMAIN_INDEX.set(domain.trim(), entry);
    });
  });

  // Hosts that look like a real site but are nearly always parked/placeholder
  // landers. Treated as leads ("no real website") with solid confidence.
  const PARKED_HOSTS = [
    "godaddy.com", "secureserver.net", "sedoparking.com", "sedo.com",
    "parkingcrew.net", "bodis.com", "afternic.com", "dan.com",
    "hugedomains.com", "domainmarket.com", "above.com", "uniregistry.com",
    "namebright.com", "parklogic.com", "fabulous.com", "domain.com",
  ];

  function cleanUrl(rawUrl) {
    return String(rawUrl || "").trim();
  }

  function hostOf(rawUrl) {
    const url = cleanUrl(rawUrl);
    if (!url) return "";
    try {
      const withProtocol = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      return new URL(withProtocol).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  function hostMatches(host, pattern) {
    return host === pattern || host.endsWith(`.${pattern}`);
  }

  function lookupCategory(host) {
    if (!host) return null;
    // Exact host hit first, then walk the dotted suffixes so subdomains match.
    if (DOMAIN_INDEX.has(host)) return DOMAIN_INDEX.get(host);
    const parts = host.split(".");
    for (let i = 1; i < parts.length - 1; i += 1) {
      const suffix = parts.slice(i).join(".");
      if (DOMAIN_INDEX.has(suffix)) return DOMAIN_INDEX.get(suffix);
    }
    return null;
  }

  /**
   * Classify a single website URL.
   *
   * Returns the lead decision plus a `baseConfidence` (0–1) describing how sure
   * we are that *this classification* is correct. Establishment signals and
   * live-verification results are layered on later in scoreLead().
   */
  function classifyWebsite(rawUrl) {
    const url = cleanUrl(rawUrl);

    if (!url) {
      return {
        isLead: true,
        tier: "none",
        category: "none",
        type: "No website",
        host: "",
        url: "",
        weakLink: "",
        baseConfidence: 0.8,
      };
    }

    const host = hostOf(url);

    if (PARKED_HOSTS.some((pattern) => hostMatches(host, pattern))) {
      return {
        isLead: true,
        tier: "weak",
        category: "parked",
        type: "Parked / for-sale domain",
        host,
        url,
        weakLink: url,
        baseConfidence: 0.85,
      };
    }

    const entry = lookupCategory(host);
    if (entry) {
      return {
        isLead: true,
        tier: "weak",
        category: entry.category,
        type: entry.label,
        host,
        url,
        weakLink: url,
        baseConfidence: entry.confidence,
      };
    }

    return {
      isLead: false,
      tier: "real",
      category: "real",
      type: "Has website",
      host,
      url,
      weakLink: url,
      baseConfidence: 0.9,
    };
  }

  /**
   * Combine the URL classification with business-establishment signals and an
   * optional live-verification result into a final lead decision + confidence.
   *
   * @param {object} place        normalized place (name, ratingCount, phone, businessStatus...)
   * @param {object} classification result of classifyWebsite()
   * @param {object} [verification]  { state: "live"|"dead"|"unknown", probes: number }
   * @returns {{ isLead, tier, category, type, confidence, reasons }}
   */
  function scoreLead(place, classification, verification) {
    const reasons = [];
    const ratingCount = Number(place?.ratingCount) || 0;
    const hasPhone = Boolean(place?.phone);
    const operational = !place?.businessStatus || place.businessStatus === "OPERATIONAL";

    let isLead = classification.isLead;
    let tier = classification.tier;
    let category = classification.category;
    let type = classification.type;
    let confidence = classification.baseConfidence;

    // --- Live verification can flip a "has website" into a dead-site lead. -----
    if (classification.category === "real") {
      if (verification?.state === "dead") {
        isLead = true;
        tier = "weak";
        category = "dead";
        type = "Website offline / unreachable";
        // Two independent failed probes are more convincing than one.
        confidence = verification.probes >= 2 ? 0.82 : 0.7;
        reasons.push("Listed website did not respond to live checks");
      } else if (verification?.state === "live") {
        confidence = 0.94;
        reasons.push("Listed website is live");
      } else {
        reasons.push("Has a listed website");
      }
      return finalize({ isLead, tier, category, type, confidence, reasons });
    }

    // --- No website at all: lean on establishment signals. --------------------
    if (classification.category === "none") {
      confidence = 0.8;
      reasons.push("Google lists no website");
      if (ratingCount >= 25) {
        confidence += 0.1;
        reasons.push(`Established business (${ratingCount} reviews)`);
      } else if (ratingCount >= 8) {
        confidence += 0.06;
        reasons.push(`${ratingCount} reviews`);
      } else if (ratingCount === 0) {
        confidence -= 0.12;
        reasons.push("No reviews yet — may be a thin or duplicate listing");
      }
      if (hasPhone) {
        confidence += 0.03;
        reasons.push("Has a phone number");
      }
      if (!operational) {
        confidence -= 0.08;
        reasons.push("Not marked operational");
      }
      return finalize({ isLead, tier, category, type, confidence, reasons });
    }

    // --- Weak presence (social / directory / builder / etc.). -----------------
    reasons.push(`Only a ${type.toLowerCase()}`);
    if (ratingCount >= 25) {
      confidence += 0.02;
      reasons.push(`Established business (${ratingCount} reviews)`);
    } else if (ratingCount === 0) {
      confidence -= 0.05;
      reasons.push("No reviews yet");
    }
    if (!operational) {
      confidence -= 0.06;
      reasons.push("Not marked operational");
    }
    return finalize({ isLead, tier, category, type, confidence, reasons });
  }

  function finalize(result) {
    const pct = Math.round(Math.max(0.4, Math.min(0.99, result.confidence)) * 100);
    return { ...result, confidence: pct };
  }

  /** Rough textual band for a confidence percentage. */
  function confidenceBand(pct) {
    if (pct >= 90) return "Very high";
    if (pct >= 80) return "High";
    if (pct >= 70) return "Moderate";
    if (pct >= 55) return "Low";
    return "Very low";
  }

  const api = {
    classifyWebsite,
    scoreLead,
    confidenceBand,
    hostOf,
    PARKED_HOSTS,
    CATEGORY_TABLE,
  };

  if (typeof window !== "undefined") {
    window.OpenScout = window.OpenScout || {};
    window.OpenScout.classify = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
