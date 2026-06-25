/**
 * OpenScout website classifier — the accuracy core.
 *
 * Given the web presence Google Places reports for a business, this module
 * decides whether the business is a real lead (no website of its own) and — just
 * as importantly — *how confident* we are. Confidence is what lets the app report
 * an honest "estimated mistake rate" and filter out the guesses it is least sure
 * about.
 *
 * The four pillars of accuracy live here:
 *   1. A large, categorised, international domain index (classifyWebsite).
 *   2. National-chain / franchise exclusion — a chain location without a listed
 *      site still has a corporate website, so it is NOT a custom-site prospect
 *      and is the single biggest source of false positives. (isChainBusiness).
 *   3. Duplicate-listing merge — a business that appears twice, once with a site
 *      and once without, genuinely has a site and must not surface as a lead.
 *      (mergeDuplicates).
 *   4. A calibrated confidence model that layers establishment signals,
 *      business-type priors, and live-verification results (scoreLead).
 *
 * The module is dependency-free and runs both in the browser (attaches to
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
        // Mainstream
        "facebook.com", "fb.com", "fb.me", "fb.watch",
        "instagram.com", "instagr.am",
        "tiktok.com", "vm.tiktok.com",
        "twitter.com", "x.com", "t.co",
        "youtube.com", "youtu.be",
        "pinterest.com", "pin.it",
        "snapchat.com",
        "threads.net",
        "linkedin.com", "lnkd.in",
        "t.me", "telegram.me",
        "wa.me", "whatsapp.com", "chat.whatsapp.com",
        "m.me",
        // Content / publishing used as a sole presence
        "tumblr.com", "reddit.com", "medium.com", "substack.com",
        "patreon.com", "twitch.tv", "rumble.com",
        "flickr.com", "behance.net", "dribbble.com",
        // International social networks
        "vk.com", "ok.ru", "weibo.com", "xing.com",
        "line.me", "kakao.com", "pllink.kakao.com",
        "nextdoor.com",
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
        "komi.io", "linkpop.com", "lnk.to", "many.link",
        "linkfire.com", "withkoji.com", "carrd.link",
      ],
    },
    {
      category: "directory",
      label: "Directory listing only",
      confidence: 0.93,
      domains: [
        // US general
        "yelp.com", "yelp.to",
        "tripadvisor.com", "tripadvisor.co.uk",
        "foursquare.com", "swarmapp.com",
        "yellowpages.com", "yp.com", "yellowpages.ca",
        "manta.com", "bbb.org",
        "angi.com", "angieslist.com", "thumbtack.com",
        "homeadvisor.com", "houzz.com", "porch.com", "buildzoom.com",
        "citysearch.com", "superpages.com",
        "dexknows.com", "hotfrog.com", "brownbook.net",
        "chamberofcommerce.com", "merchantcircle.com",
        "mapquest.com", "cylex.us.com", "opendi.us", "ezlocal.com",
        "expertise.com", "trustpilot.com", "sitejabber.com",
        // Health
        "healthgrades.com", "zocdoc.com", "vitals.com", "wellness.com",
        "ratemds.com", "webmd.com", "doctor.com", "sharecare.com",
        // Legal
        "avvo.com", "justia.com", "findlaw.com", "lawyers.com", "martindale.com",
        // Real estate
        "zillow.com", "realtor.com", "trulia.com", "redfin.com",
        // Events / weddings
        "weddingwire.com", "theknot.com", "bark.com", "gigsalad.com",
        // International directories
        "yell.com", "thomsonlocal.com", "scoot.co.uk",
        "checkatrade.com", "ratedpeople.com", "mybuilder.com", "trustatrader.com",
        "rightmove.co.uk", "zoopla.co.uk", "onthemarket.com",
        "pagesjaunes.fr", "gelbeseiten.de", "dasoertliche.de", "11880.com",
        "paginegialle.it", "paginasamarillas.es",
        "yellowpages.com.au", "truelocal.com.au", "localsearch.com.au", "hotfrog.com.au",
        "goldenpages.ie", "justdial.com", "sulekha.com", "practo.com",
        "2gis.ru", "zomato.com", "ubereats.com",
        "n49.com", "cybo.com", "tupalo.com", "fyple.com",
      ],
    },
    {
      category: "booking",
      label: "Booking page only",
      confidence: 0.92,
      domains: [
        "vagaro.com", "booksy.com", "styleseat.com", "schedulicity.com",
        "mindbodyonline.com", "mindbody.io", "fresha.com",
        "squareup.com", "setmore.com", "acuityscheduling.com", "app.acuityscheduling.com",
        "simplybook.me", "getsquire.com", "glossgenius.com",
        "calendly.com", "noterro.com", "janeapp.com", "timetap.com",
        "appointy.com", "genbook.com", "schedulista.com",
        "opentable.com", "resy.com", "exploretock.com", "yelp.com/reservations",
        // International booking
        "treatwell.com", "treatwell.co.uk", "planity.com", "shedul.com",
        "thefork.com", "quandoo.com", "doctolib.fr", "doctolib.de",
        "salonized.com", "ovatu.com", "phorest.com",
      ],
    },
    {
      category: "ordering",
      label: "Ordering page only",
      confidence: 0.9,
      domains: [
        // US
        "doordash.com", "ubereats.com", "grubhub.com", "postmates.com",
        "seamless.com", "chownow.com", "toasttab.com", "order.online",
        "clover.com", "slicelife.com", "beyondmenu.com", "menufy.com", "ezcater.com",
        "spoton.com", "popmenu.com", "allset.com", "gloriafood.com", "flipdish.com",
        "snackpass.co", "caviar.com",
        // International
        "justeat.com", "just-eat.co.uk", "just-eat.ca", "just-eat.ie",
        "deliveroo.com", "deliveroo.co.uk", "deliveroo.fr",
        "foodora.com", "wolt.com", "lieferando.de", "takeaway.com",
        "swiggy.com", "rappi.com", "ifood.com.br", "glovoapp.com",
        "talabat.com", "foodpanda.com", "menulog.com.au", "skipthedishes.com",
        "hungerstation.com", "zomato.com",
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
        "amazon.com", "walmart.com", "aliexpress.com", "alibaba.com",
        "reverb.com", "discogs.com", "offerup.com", "gumtree.com",
        "vinted.com", "grailed.com", "stockx.com",
        "redbubble.com", "society6.com", "gumroad.com", "payhip.com", "sellfy.com",
        "indiamart.com", "tradeindia.com",
      ],
    },
    {
      category: "gmb",
      label: "Google profile only",
      confidence: 0.95,
      domains: [
        "g.page", "business.google.com", "goo.gl", "maps.app.goo.gl",
        "maps.google.com", "page.link", "g.co", "share.google",
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
        "wixsite.com", "editorx.io", "wixstudio.com",
        "weebly.com", "weeblysite.com",
        "square.site", "company.site", "shopsettings.com",
        "squarespace.com",
        "wordpress.com",
        "blogspot.com",
        "webnode.com", "webnode.page",
        "jimdosite.com", "jimdo.com", "jimdofree.com",
        "strikingly.com", "mystrikingly.com",
        "webador.com", "website2.me", "simplesite.com",
        "ucraft.net", "tilda.ws", "carrd.co",
        "myshopify.com",
        "glideapp.io", "softr.app", "durable.co", "b12.io",
        // Free hosting / no-domain forms
        "netlify.app", "vercel.app", "github.io", "gitlab.io", "pages.dev",
        "web.app", "firebaseapp.com", "herokuapp.com", "onrender.com",
        "glitch.me", "replit.app", "000webhostapp.com", "azurewebsites.net",
        "webflow.io", "framer.website", "framer.app",
        "notion.site", "super.site",
        // No-domain small-biz builders
        "ueniweb.com", "ueni.com", "websites.co.in", "yolasite.com",
        "site123.me", "webstarts.com", "mozello.com", "doodlekit.com",
      ],
    },
  ];

  // Flatten the table into a single lookup keyed by host pattern for O(1)-ish
  // matching, while keeping the richer entry for labels/confidence.
  const DOMAIN_INDEX = new Map();
  CATEGORY_TABLE.forEach((entry) => {
    entry.domains.forEach((domain) => {
      // Some entries carry a path hint (e.g. "yelp.com/reservations"); index by
      // host only — the path is documentation, the host is what we match.
      const host = domain.split("/")[0].trim();
      if (host && !DOMAIN_INDEX.has(host)) DOMAIN_INDEX.set(host, entry);
    });
  });

  // Hosts that look like a real site but are nearly always parked/placeholder
  // landers. Treated as leads ("no real website") with solid confidence.
  const PARKED_HOSTS = [
    "godaddy.com", "secureserver.net", "sedoparking.com", "sedo.com",
    "parkingcrew.net", "bodis.com", "afternic.com", "dan.com",
    "hugedomains.com", "domainmarket.com", "above.com", "uniregistry.com",
    "namebright.com", "parklogic.com", "fabulous.com", "domain.com",
    "cashparking.com", "parking.com", "voodoo.com", "smartname.com",
    "name.com", "undeveloped.com", "brandbucket.com", "epik.com",
    "1and1.com", "ionos.com", "networksolutions.com", "register.com",
  ];

  // ---------------------------------------------------------------------------
  // National chains / franchises
  //
  // A chain location whose Google listing has no website still has a corporate
  // website and cannot buy a custom site — so it is NOT a prospect, and counting
  // it is a mistake. We exclude recognised chains. The list is deliberately
  // limited to *distinctive* brand tokens to avoid excluding independent shops
  // that merely share a common surname/word (we drop ambiguous names like
  // "Ross", "Gap", bare car-maker names, etc.).
  // ---------------------------------------------------------------------------
  const CHAIN_BRANDS = [
    // Fast food / quick service
    "mcdonalds", "burger king", "wendys", "taco bell", "kfc", "subway",
    "starbucks", "dunkin", "dominos", "pizza hut", "papa johns",
    "little caesars", "chipotle", "chick fil a", "popeyes", "sonic drive",
    "arbys", "dairy queen", "jack in the box", "carls jr", "hardees",
    "whataburger", "in n out", "five guys", "shake shack", "panera",
    "panda express", "jimmy johns", "jersey mikes", "firehouse subs",
    "wingstop", "buffalo wild wings", "qdoba", "moes southwest", "del taco",
    "el pollo loco", "raising canes", "bojangles", "zaxbys", "culvers",
    "white castle", "captain ds", "long john silvers", "auntie annes",
    "cinnabon", "baskin robbins", "cold stone", "krispy kreme", "tim hortons",
    "dutch bros", "caribou coffee",
    // Casual dining
    "applebees", "chilis", "olive garden", "red lobster", "outback steakhouse",
    "ihop", "dennys", "cracker barrel", "waffle house", "texas roadhouse",
    "longhorn steakhouse", "red robin", "tgi fridays", "cheesecake factory",
    "golden corral", "ruby tuesday",
    // Grocery / big box
    "walmart", "costco", "sams club", "kroger", "safeway",
    "albertsons", "publix", "trader joes", "whole foods", "wegmans",
    "meijer", "dollar general", "dollar tree", "family dollar",
    "walgreens", "rite aid", "7 eleven", "circle k", "wawa", "sheetz",
    // Home / hardware / electronics
    "home depot", "lowes", "menards", "ace hardware", "best buy", "gamestop",
    "staples", "office depot", "petco", "petsmart", "autozone",
    "oreilly auto", "advance auto", "napa auto", "pep boys",
    "hobby lobby", "big lots", "tj maxx", "homegoods",
    // Apparel / beauty retail
    "old navy", "banana republic", "uniqlo", "forever 21", "american eagle",
    "victorias secret", "bath and body works", "ulta beauty", "sephora",
    "foot locker", "dicks sporting goods", "academy sports", "bass pro",
    "cabelas", "ashley furniture", "mattress firm",
    // Services / personal care
    "ups store", "fedex office", "h and r block", "jackson hewitt",
    "liberty tax", "great clips", "supercuts", "sport clips", "fantastic sams",
    "european wax", "massage envy", "planet fitness", "la fitness",
    "anytime fitness", "orangetheory", "crunch fitness", "snap fitness",
    // Auto service
    "jiffy lube", "valvoline", "meineke", "firestone complete",
    "discount tire", "les schwab", "aamco", "maaco",
    // Travel / lodging
    "enterprise rent", "hertz", "u haul", "penske", "public storage",
    "extra space", "marriott", "hilton", "holiday inn", "hampton inn",
    "best western", "comfort inn", "days inn", "super 8", "motel 6",
    "la quinta", "courtyard by", "residence inn", "doubletree",
    "embassy suites", "fairfield inn", "quality inn", "econo lodge",
    // Banks / insurance / telecom (storefronts)
    "wells fargo", "bank of america", "chase bank", "citibank", "us bank",
    "pnc bank", "td bank", "capital one", "regions bank",
    "state farm", "geico", "progressive insurance", "allstate",
    "edward jones", "verizon", "t mobile", "metro by t mobile",
    "boost mobile", "cricket wireless", "xfinity",
  ];

  // Pre-normalise the brand list once so matching is a cheap startsWith.
  const NORMALIZED_CHAINS = CHAIN_BRANDS.map(normalizeName).filter(Boolean);

  // Business types where a missing listed website is *less* telling — these
  // categories almost always have a site even when Google does not list it, so
  // we shade confidence down a touch to stay honest.
  const SITE_LIKELY_TYPES = new Set([
    "lawyer", "attorney", "legal_services",
    "dentist", "doctor", "physiotherapist", "hospital", "medical_clinic",
    "real_estate_agency", "insurance_agency", "accounting", "bank",
    "finance", "university", "school", "primary_school", "secondary_school",
    "car_dealer", "travel_agency",
  ]);

  // ---------------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------------
  function cleanUrl(rawUrl) {
    return String(rawUrl || "").trim();
  }

  // Some "websites" Google reports are not real sites at all (tel:, mailto:, a
  // bare phone number, a plus-code). Treat these as "no website".
  function isNonWebUrl(url) {
    if (!url) return true;
    if (/^(tel:|mailto:|sms:|fax:|callto:|javascript:)/i.test(url)) return true;
    // A value with no dot and no scheme is not a hostname (e.g. a phone number).
    if (!/\./.test(url) && !/^https?:\/\//i.test(url)) return true;
    return false;
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

  // ---------------------------------------------------------------------------
  // Name normalisation + chain detection
  // ---------------------------------------------------------------------------
  function normalizeName(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .toLowerCase()
      .replace(/['\u2019`]/g, "") // drop apostrophes so "mcdonald's" -> "mcdonalds"
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Is this business a recognised national chain / franchise? A chain location
   * has a corporate website even when its Google profile omits one, so it is not
   * a custom-site prospect. Matching is conservative: the normalised name must
   * equal a brand or begin with "<brand> " so independent shops that merely
   * contain a brand word elsewhere are not excluded.
   */
  function isChainBusiness(name) {
    const normalized = normalizeName(name);
    if (!normalized) return false;
    return NORMALIZED_CHAINS.some(
      (brand) => normalized === brand || normalized.startsWith(`${brand} `)
    );
  }

  function collectTypes(place) {
    const types = [];
    if (place?.primaryType) types.push(place.primaryType);
    if (Array.isArray(place?.types)) types.push(...place.types);
    return types;
  }

  // ---------------------------------------------------------------------------
  // Classification
  // ---------------------------------------------------------------------------
  /**
   * Classify a single website URL.
   *
   * Returns the lead decision plus a `baseConfidence` (0–1) describing how sure
   * we are that *this classification* is correct. Establishment signals, chain
   * detection and live-verification results are layered on later in scoreLead().
   */
  function classifyWebsite(rawUrl) {
    const url = cleanUrl(rawUrl);

    if (isNonWebUrl(url)) {
      return {
        isLead: true,
        tier: "none",
        category: "none",
        type: "No website",
        host: "",
        url: "",
        weakLink: "",
        baseConfidence: 0.86,
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
        baseConfidence: 0.86,
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
      baseConfidence: 0.92,
    };
  }

  // Rank of how strong a web presence a classification represents. Higher =
  // closer to "a real, independent website". Used to merge duplicate listings:
  // when the same business is listed twice, the strongest presence wins.
  const PRESENCE_RANK = {
    real: 5,
    builder: 2,
    parked: 1,
    marketplace: 2,
    ordering: 2,
    booking: 2,
    directory: 2,
    gmb: 1,
    linkbio: 1,
    social: 1,
    none: 0,
  };

  function presenceRank(url) {
    return PRESENCE_RANK[classifyWebsite(url).category] ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Confidence scoring
  // ---------------------------------------------------------------------------
  function reviewAdjust(count, reasons, strong) {
    if (count >= 50) {
      reasons.push(`Well-established (${count} reviews)`);
      return strong ? 0.1 : 0.04;
    }
    if (count >= 20) {
      reasons.push(`Established (${count} reviews)`);
      return strong ? 0.08 : 0.03;
    }
    if (count >= 8) {
      reasons.push(`${count} reviews`);
      return strong ? 0.04 : 0.01;
    }
    if (count >= 3) {
      reasons.push(`${count} reviews`);
      return 0;
    }
    if (count === 0) {
      reasons.push("No reviews yet — may be a thin or duplicate listing");
      return strong ? -0.16 : -0.08;
    }
    reasons.push(`${count} review${count === 1 ? "" : "s"}`);
    return strong ? -0.06 : -0.03;
  }

  function typeAdjust(types, reasons) {
    if (types.some((type) => SITE_LIKELY_TYPES.has(type))) {
      reasons.push("Category usually has a site — absence is less certain");
      return -0.05;
    }
    return 0;
  }

  /**
   * Combine the URL classification with chain detection, business-establishment
   * signals, business-type priors and an optional live-verification result into
   * a final lead decision + confidence.
   *
   * @param {object} place          normalized place (name, ratingCount, phone, businessStatus, types...)
   * @param {object} classification result of classifyWebsite()
   * @param {object} [verification] { state: "live"|"dead"|"unknown", probes: number }
   * @returns {{ isLead, tier, category, type, confidence, reasons, excluded? }}
   */
  function scoreLead(place, classification, verification) {
    const reasons = [];
    const name = place?.name || place?.displayName || "";
    const ratingCount = Number(place?.ratingCount) || 0;
    const hasPhone = Boolean(place?.phone);
    const operational = !place?.businessStatus || place.businessStatus === "OPERATIONAL";
    const types = collectTypes(place);

    // --- 0) National chain / franchise => has a corporate site, not a prospect.
    if (isChainBusiness(name)) {
      return finalize({
        isLead: false,
        tier: "chain",
        category: "chain",
        type: "National chain (has a corporate site)",
        confidence: 0.9,
        reasons: ["Recognised national chain — almost certainly has a corporate website"],
        excluded: "chain",
      });
    }

    let { isLead, tier, category, type } = classification;
    let confidence = classification.baseConfidence;

    // --- 1) Listed "real" site: live verification can flip it to a dead lead. --
    if (classification.category === "real") {
      if (verification?.state === "dead") {
        isLead = true;
        tier = "weak";
        category = "dead";
        type = "Website offline / unreachable";
        confidence = verification.probes >= 2 ? 0.9 : 0.74;
        reasons.push(
          verification.probes >= 2
            ? "Listed website failed multiple independent live checks"
            : "Listed website did not respond to a live check"
        );
        confidence += typeAdjust(types, reasons);
        return finalize({ isLead, tier, category, type, confidence, reasons });
      }
      if (verification?.state === "live") {
        reasons.push("Listed website is live");
        return finalize({ isLead: false, tier, category, type, confidence: 0.96, reasons });
      }
      reasons.push("Has a listed website");
      return finalize({ isLead: false, tier, category, type, confidence: 0.92, reasons });
    }

    // --- 2) No website at all: lean on establishment signals. ------------------
    if (classification.category === "none") {
      confidence = 0.86;
      reasons.push("Google lists no website");
      confidence += reviewAdjust(ratingCount, reasons, true);
      if (hasPhone) {
        confidence += 0.03;
        reasons.push("Has a phone number");
      } else {
        confidence -= 0.05;
        reasons.push("No phone number listed");
      }
      if (!operational) {
        confidence -= 0.1;
        reasons.push("Not marked operational");
      }
      confidence += typeAdjust(types, reasons);
      return finalize({ isLead, tier, category, type, confidence, reasons });
    }

    // --- 3) Weak presence (social / directory / builder / parked / etc.). ------
    reasons.push(`Only a ${type.toLowerCase()}`);
    confidence += reviewAdjust(ratingCount, reasons, false);
    if (!operational) {
      confidence -= 0.06;
      reasons.push("Not marked operational");
    }
    confidence += typeAdjust(types, reasons);
    return finalize({ isLead, tier, category, type, confidence, reasons });
  }

  function finalize(result) {
    const pct = Math.round(Math.max(0.35, Math.min(0.99, result.confidence)) * 100);
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

  // ---------------------------------------------------------------------------
  // Duplicate-listing merge
  //
  // Google Text Search, tiled across overlapping cells, frequently returns the
  // same business more than once — and worse, sometimes as near-duplicate
  // listings where one copy has a website and another does not. Surfacing the
  // siteless copy as a lead is a false positive. We merge listings that share a
  // normalised name and sit within a small radius, keeping the *strongest* web
  // presence found across the cluster so a business that has a site anywhere is
  // never reported as siteless.
  // ---------------------------------------------------------------------------
  function distanceMeters(a, b) {
    const lat1 = Number(a?.lat);
    const lng1 = Number(a?.lng);
    const lat2 = Number(b?.lat);
    const lng2 = Number(b?.lng);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function mergeDuplicates(places, options = {}) {
    const radius = Number.isFinite(options.radiusMeters) ? options.radiusMeters : 90;
    const clusters = [];

    (places || []).forEach((place) => {
      const key = normalizeName(place?.name);
      if (!key) {
        clusters.push({ key: `__${clusters.length}`, members: [place] });
        return;
      }
      const cluster = clusters.find((c) => {
        if (c.key !== key) return false;
        // Same name: same business if close together, or if either lacks coords
        // (Places almost always has coords; missing implies we can't split them).
        const d = distanceMeters(c.members[0], place);
        return d <= radius || !Number.isFinite(d);
      });
      if (cluster) {
        cluster.members.push(place);
      } else {
        clusters.push({ key, members: [place] });
      }
    });

    return clusters.map((cluster) => mergeCluster(cluster.members));
  }

  function mergeCluster(members) {
    if (members.length === 1) return members[0];

    // Representative = the member with the strongest web presence, then the most
    // reviews. This guarantees a business that has a real site in *any* listing
    // is treated as having one.
    const best = members
      .slice()
      .sort((a, b) => {
        const presence = presenceRank(b.website) - presenceRank(a.website);
        if (presence) return presence;
        return (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0);
      })[0];

    const strongestWebsite = members
      .map((m) => m.website)
      .filter(Boolean)
      .sort((a, b) => presenceRank(b) - presenceRank(a))[0] || best.website || "";

    const maxReviews = Math.max(...members.map((m) => Number(m.ratingCount) || 0));
    const phone = members.map((m) => m.phone).find(Boolean) || best.phone || "";

    return {
      ...best,
      website: strongestWebsite,
      phone,
      ratingCount: maxReviews || best.ratingCount,
      mergedFrom: members.length,
    };
  }

  const api = {
    classifyWebsite,
    scoreLead,
    confidenceBand,
    hostOf,
    isChainBusiness,
    isNonWebUrl,
    normalizeName,
    distanceMeters,
    mergeDuplicates,
    presenceRank,
    PARKED_HOSTS,
    CHAIN_BRANDS,
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
