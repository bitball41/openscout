"use strict";

// Unit tests for OpenScout's pure accuracy logic: classification, chain
// exclusion, duplicate merge, confidence scoring, and the live-verification
// decision logic. Run with: node test/classify.test.js
const assert = require("assert");
const classify = require("../js/classify.js");
const verify = require("../js/verify.js");
const location = require("../js/location.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ===========================================================================
console.log("classifyWebsite — categories");
// ===========================================================================

test("empty website is a no-website lead", () => {
  const r = classify.classifyWebsite("");
  assert.strictEqual(r.isLead, true);
  assert.strictEqual(r.category, "none");
  assert.strictEqual(r.tier, "none");
});

test("non-web values (tel:/mailto:/phone) read as no website", () => {
  assert.strictEqual(classify.classifyWebsite("tel:+15551234567").category, "none");
  assert.strictEqual(classify.classifyWebsite("mailto:hi@x.com").category, "none");
  assert.strictEqual(classify.classifyWebsite("(555) 123-4567").category, "none");
});

test("facebook page is a social weak lead", () => {
  const r = classify.classifyWebsite("https://www.facebook.com/joesbarber");
  assert.strictEqual(r.category, "social");
  assert.strictEqual(r.isLead, true);
  assert.strictEqual(r.tier, "weak");
});

test("subdomain social hosts match (m.facebook.com)", () => {
  assert.strictEqual(classify.classifyWebsite("https://m.facebook.com/x").category, "social");
});

test("international social networks are caught (vk, weibo, line)", () => {
  assert.strictEqual(classify.classifyWebsite("https://vk.com/x").category, "social");
  assert.strictEqual(classify.classifyWebsite("https://weibo.com/x").category, "social");
  assert.strictEqual(classify.classifyWebsite("https://line.me/x").category, "social");
});

test("link-in-bio pages are caught (linktree, beacons, komi)", () => {
  assert.strictEqual(classify.classifyWebsite("https://linktr.ee/x").category, "linkbio");
  assert.strictEqual(classify.classifyWebsite("https://beacons.ai/x").category, "linkbio");
  assert.strictEqual(classify.classifyWebsite("https://komi.io/x").category, "linkbio");
});

test("directories are caught, incl. international (yelp, yell, gelbeseiten)", () => {
  assert.strictEqual(classify.classifyWebsite("https://www.yelp.com/biz/x").category, "directory");
  assert.strictEqual(classify.classifyWebsite("https://www.yell.com/biz/x").category, "directory");
  assert.strictEqual(classify.classifyWebsite("https://gelbeseiten.de/x").category, "directory");
});

test("ordering platforms are caught, incl. international (doordash, deliveroo, swiggy)", () => {
  assert.strictEqual(classify.classifyWebsite("https://www.doordash.com/store/x").category, "ordering");
  assert.strictEqual(classify.classifyWebsite("https://deliveroo.co.uk/menu/x").category, "ordering");
  assert.strictEqual(classify.classifyWebsite("https://www.swiggy.com/x").category, "ordering");
});

test("booking platforms are caught, incl. international (vagaro, treatwell, doctolib)", () => {
  assert.strictEqual(classify.classifyWebsite("https://www.vagaro.com/x").category, "booking");
  assert.strictEqual(classify.classifyWebsite("https://treatwell.co.uk/place/x").category, "booking");
  assert.strictEqual(classify.classifyWebsite("https://doctolib.fr/x").category, "booking");
});

test("marketplace storefronts are caught (etsy, amazon, indiamart)", () => {
  assert.strictEqual(classify.classifyWebsite("https://www.etsy.com/shop/x").category, "marketplace");
  assert.strictEqual(classify.classifyWebsite("https://www.amazon.com/shops/x").category, "marketplace");
  assert.strictEqual(classify.classifyWebsite("https://indiamart.com/x").category, "marketplace");
});

test("free builder subdomains are builder leads (wix, ueni, notion)", () => {
  assert.strictEqual(classify.classifyWebsite("https://abc.wixsite.com/site").category, "builder");
  assert.strictEqual(classify.classifyWebsite("https://business.site/").category, "builder");
  assert.strictEqual(classify.classifyWebsite("https://acme.ueniweb.com/").category, "builder");
  assert.strictEqual(classify.classifyWebsite("https://acme.notion.site/").category, "builder");
});

test("google profile links are gmb leads", () => {
  assert.strictEqual(classify.classifyWebsite("https://g.page/x").category, "gmb");
  assert.strictEqual(classify.classifyWebsite("https://maps.app.goo.gl/x").category, "gmb");
});

test("parked / registrar domains are flagged", () => {
  assert.strictEqual(classify.classifyWebsite("https://sedoparking.com/foo").category, "parked");
  assert.strictEqual(classify.classifyWebsite("https://example.secureserver.net/").category, "parked");
  assert.strictEqual(classify.classifyWebsite("https://hugedomains.com/x").category, "parked");
});

test("a real custom domain is not a lead", () => {
  const r = classify.classifyWebsite("https://www.joesrealbakery.com");
  assert.strictEqual(r.isLead, false);
  assert.strictEqual(r.category, "real");
});

test("a custom domain on Wix (no free subdomain) reads as real", () => {
  // Only *.wixsite.com is a builder signal; a real domain is indistinguishable.
  assert.strictEqual(classify.classifyWebsite("https://joesbakery.com").category, "real");
});

test("hostOf strips www and protocol", () => {
  assert.strictEqual(classify.hostOf("https://www.Example.com/path"), "example.com");
  assert.strictEqual(classify.hostOf("Example.org"), "example.org");
});

// ===========================================================================
console.log("normalizeName + isChainBusiness");
// ===========================================================================

test("normalizeName lowercases, strips diacritics, apostrophes, punctuation", () => {
  assert.strictEqual(classify.normalizeName("Crème Brûlée Café"), "creme brulee cafe");
  assert.strictEqual(classify.normalizeName("McDonald's #4521"), "mcdonalds 4521");
  assert.strictEqual(classify.normalizeName("H&R Block"), "h and r block");
});

test("recognised chains are detected (with store numbers / suffixes)", () => {
  assert.ok(classify.isChainBusiness("McDonald's #4521"));
  assert.ok(classify.isChainBusiness("Starbucks Reserve"));
  assert.ok(classify.isChainBusiness("Planet Fitness"));
  assert.ok(classify.isChainBusiness("7-Eleven"));
  assert.ok(classify.isChainBusiness("Chick-fil-A"));
  assert.ok(classify.isChainBusiness("Wendy's"));
});

test("independent shops sharing a common word are NOT chains", () => {
  assert.ok(!classify.isChainBusiness("Joe's Coffee"));
  assert.ok(!classify.isChainBusiness("Rossi's Pizzeria")); // not "Ross"
  assert.ok(!classify.isChainBusiness("Gappy's Diner")); // not "Gap"
  assert.ok(!classify.isChainBusiness("Target Practice Indoor Range")); // edge: distinct biz
  assert.ok(!classify.isChainBusiness(""));
});

// ===========================================================================
console.log("scoreLead — chains, establishment, verification");
// ===========================================================================

test("a chain is excluded as a non-lead even with no website + many reviews", () => {
  const place = { name: "Subway #1234", ratingCount: 80, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite(""), null);
  assert.strictEqual(s.isLead, false);
  assert.strictEqual(s.category, "chain");
  assert.strictEqual(s.excluded, "chain");
});

test("established no-website business scores very high", () => {
  const place = { name: "Joe's Barber", ratingCount: 40, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite(""), null);
  assert.strictEqual(s.isLead, true);
  assert.ok(s.confidence >= 90, `expected >=90, got ${s.confidence}`);
});

test("zero-review no-website listing is penalised", () => {
  const place = { name: "Mystery LLC", ratingCount: 0, phone: "", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite(""), null);
  assert.ok(s.confidence < 75, `expected <75, got ${s.confidence}`);
});

test("professional-services type lowers confidence vs a generic shop", () => {
  const base = { name: "X", ratingCount: 10, phone: "555", businessStatus: "OPERATIONAL" };
  const generic = classify.scoreLead(base, classify.classifyWebsite(""), null);
  const lawyer = classify.scoreLead({ ...base, primaryType: "lawyer" }, classify.classifyWebsite(""), null);
  assert.ok(lawyer.confidence < generic.confidence, `${lawyer.confidence} !< ${generic.confidence}`);
});

test("social-only established business is a confident lead", () => {
  const place = { name: "Ink Tattoo Studio", ratingCount: 30, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite("https://facebook.com/ink"), null);
  assert.strictEqual(s.isLead, true);
  assert.ok(s.confidence >= 85, `expected >=85, got ${s.confidence}`);
});

test("real site verified dead (2 probes) becomes a strong lead", () => {
  const place = { name: "Old Diner", ratingCount: 10, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite("https://deadbiz.com"), { state: "dead", probes: 2 });
  assert.strictEqual(s.isLead, true);
  assert.strictEqual(s.category, "dead");
  assert.ok(s.confidence >= 85, `expected >=85, got ${s.confidence}`);
});

test("real site dead on a single probe is a weak, filterable lead", () => {
  const place = { name: "Maybe Gone", ratingCount: 5, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite("https://maybe.com"), { state: "dead", probes: 1 });
  assert.strictEqual(s.isLead, true);
  assert.ok(s.confidence < 80, `expected <80 (filtered by Balanced), got ${s.confidence}`);
});

test("real site verified live stays a non-lead", () => {
  const place = { name: "Live Co", ratingCount: 10, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite("https://livebiz.com"), { state: "live", probes: 1 });
  assert.strictEqual(s.isLead, false);
});

test("unverified real site is not a lead", () => {
  const place = { name: "Has Site", ratingCount: 10, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite("https://hassite.com"), null);
  assert.strictEqual(s.isLead, false);
});

test("confidence is clamped to [35,99]", () => {
  const place = { name: "Ghost", ratingCount: 0, phone: "", businessStatus: "CLOSED_TEMPORARILY", primaryType: "lawyer" };
  const s = classify.scoreLead(place, classify.classifyWebsite(""), null);
  assert.ok(s.confidence >= 35 && s.confidence <= 99, `got ${s.confidence}`);
});

// ===========================================================================
console.log("scoreLead — calibration (estimated mistakes < 10% in Balanced)");
// ===========================================================================

test("a typical Balanced-surfaced set has an estimated mistake rate < 10%", () => {
  const cw = classify.classifyWebsite;
  const leads = [
    classify.scoreLead({ name: "A", ratingCount: 40, phone: "5" }, cw(""), null),
    classify.scoreLead({ name: "B", ratingCount: 120, phone: "5" }, cw(""), null),
    classify.scoreLead({ name: "C", ratingCount: 30, phone: "5" }, cw("https://facebook.com/c"), null),
    classify.scoreLead({ name: "D", ratingCount: 15, phone: "5" }, cw("https://d.wixsite.com/d"), null),
    classify.scoreLead({ name: "E", ratingCount: 60, phone: "5" }, cw("https://yelp.com/biz/e"), null),
    classify.scoreLead({ name: "F", ratingCount: 10, phone: "5" }, cw("https://f.com"), { state: "dead", probes: 2 }),
    classify.scoreLead({ name: "G", ratingCount: 12, phone: "5" }, cw(""), null),
  ];
  const surfaced = leads.filter((l) => l.isLead && l.confidence >= 80);
  assert.strictEqual(surfaced.length, leads.length, "all should clear Balanced (80)");
  const mean = surfaced.reduce((s, l) => s + l.confidence, 0) / surfaced.length;
  const mistakeRate = 100 - mean;
  assert.ok(mistakeRate < 10, `estimated mistake rate ${mistakeRate.toFixed(1)}% should be < 10%`);
});

// ===========================================================================
console.log("mergeDuplicates");
// ===========================================================================

test("same-name nearby listings merge, keeping the strongest web presence", () => {
  const places = [
    { id: "1", name: "Joe's Pizza", lat: 40.0000, lng: -73.0000, website: "", ratingCount: 5 },
    { id: "2", name: "Joe's Pizza", lat: 40.0001, lng: -73.0001, website: "https://joespizza.com", ratingCount: 12 },
  ];
  const merged = classify.mergeDuplicates(places);
  assert.strictEqual(merged.length, 1, "should collapse to one business");
  assert.strictEqual(classify.classifyWebsite(merged[0].website).category, "real");
  assert.strictEqual(merged[0].ratingCount, 12, "keeps the higher review count");
});

test("same name but far apart are distinct businesses (not merged)", () => {
  const places = [
    { id: "1", name: "City Cafe", lat: 40.0, lng: -73.0, website: "", ratingCount: 5 },
    { id: "2", name: "City Cafe", lat: 41.0, lng: -74.0, website: "", ratingCount: 9 },
  ];
  assert.strictEqual(classify.mergeDuplicates(places).length, 2);
});

test("different names are never merged", () => {
  const places = [
    { id: "1", name: "Alpha", lat: 40.0, lng: -73.0, website: "" },
    { id: "2", name: "Beta", lat: 40.0, lng: -73.0, website: "" },
  ];
  assert.strictEqual(classify.mergeDuplicates(places).length, 2);
});

test("a business listed with and without a site no longer reads as siteless", () => {
  const places = [
    { id: "1", name: "Bloom Florist", lat: 30.0, lng: -97.0, website: "", ratingCount: 20 },
    { id: "2", name: "Bloom Florist", lat: 30.0001, lng: -97.0, website: "https://bloomflorist.com", ratingCount: 20 },
  ];
  const merged = classify.mergeDuplicates(places);
  const score = classify.scoreLead(merged[0], classify.classifyWebsite(merged[0].website), { state: "live", probes: 1 });
  assert.strictEqual(score.isLead, false);
});

// ===========================================================================
console.log("verify.summarize (multi-endpoint decision)");
// ===========================================================================

test("any ok signal => live", () => {
  assert.strictEqual(verify.summarize({ fetch: ["fail", "ok"], favicon: ["fail"] }).state, "live");
  assert.strictEqual(verify.summarize({ fetch: ["fail"], favicon: ["ok"] }).state, "live");
});

test("all fetches fail at network level, no timeout => dead", () => {
  const r = verify.summarize({ fetch: ["fail", "fail"], favicon: ["fail"] });
  assert.strictEqual(r.state, "dead");
  assert.strictEqual(r.probes, 3);
});

test("a hanging timeout blocks a dead verdict (stays unknown)", () => {
  assert.strictEqual(verify.summarize({ fetch: ["fail", "timeout"], favicon: ["fail"] }).state, "unknown");
  assert.strictEqual(verify.summarize({ fetch: ["timeout"], favicon: ["fail"] }).state, "unknown");
});

test("no signals at all => unknown", () => {
  assert.strictEqual(verify.summarize({ fetch: [], favicon: [] }).state, "unknown");
});

// ===========================================================================
console.log("verify.interpretProbes (back-compat) + normalizeForProbe");
// ===========================================================================

test("any ok probe => live", () => {
  assert.strictEqual(verify.interpretProbes("ok", "fail").state, "live");
  assert.strictEqual(verify.interpretProbes("fail", "ok").state, "live");
});

test("network fail with no positive => dead", () => {
  const r = verify.interpretProbes("fail", "fail");
  assert.strictEqual(r.state, "dead");
  assert.strictEqual(r.probes, 2);
});

test("fetch timeout never declares dead (conservative)", () => {
  assert.strictEqual(verify.interpretProbes("timeout", "fail").state, "unknown");
  assert.strictEqual(verify.interpretProbes("timeout", "timeout").state, "unknown");
});

test("fetch fail + favicon timeout => dead with 1 probe", () => {
  const r = verify.interpretProbes("fail", "timeout");
  assert.strictEqual(r.state, "dead");
  assert.strictEqual(r.probes, 1);
});

test("adds https when missing", () => {
  assert.strictEqual(verify.normalizeForProbe("example.com"), "https://example.com");
  assert.strictEqual(verify.normalizeForProbe("http://example.com"), "http://example.com");
  assert.strictEqual(verify.normalizeForProbe(""), "");
});

test("endpointVariants covers scheme + www/apex, primary first", () => {
  const v = verify.endpointVariants("example.com");
  assert.strictEqual(v[0], "https://example.com");
  assert.ok(v.includes("https://www.example.com"));
  assert.ok(v.includes("http://example.com"));
  assert.ok(v.includes("http://www.example.com"));
  assert.strictEqual(verify.endpointVariants("http://foo.com")[0], "http://foo.com");
});

// ===========================================================================
console.log("location.pickIpConsensus (multi-provider IP agreement)");
// ===========================================================================

const A = { lat: 40.0, lng: -73.0, city: "Alpha", region: "NY", country: "US" };
const Aclose = { lat: 40.05, lng: -73.0, city: "AlphaClose" }; // ~5.5km from A
const B = { lat: 34.0, lng: -118.0, city: "Bravo" }; // far from A
const C = { lat: 34.02, lng: -118.0, city: "Charlie" }; // ~2.2km from B, far from A

test("no hits => null, single hit => that hit", () => {
  assert.strictEqual(location.pickIpConsensus([]), null);
  const one = location.pickIpConsensus([A]);
  assert.strictEqual(one.lat, 40.0);
  assert.strictEqual(one.city, "Alpha");
});

test("first two providers agree => averaged", () => {
  const r = location.pickIpConsensus([A, Aclose]);
  assert.ok(Math.abs(r.lat - 40.025) < 1e-6, `lat ${r.lat}`);
  assert.strictEqual(r.lng, -73.0);
});

test("provider 1 and 3 agree (provider 2 is an outlier) => averaged pair", () => {
  // This is the bug the review flagged: the agreeing pair is (0,2), not (0,1).
  const r = location.pickIpConsensus([A, B, Aclose]);
  assert.ok(Math.abs(r.lat - 40.025) < 1e-6, `expected ~40.025, got ${r.lat}`);
  assert.strictEqual(r.lng, -73.0);
});

test("providers 2 and 3 agree (first is the outlier) => their average", () => {
  const r = location.pickIpConsensus([A, B, C]);
  assert.ok(Math.abs(r.lat - 34.01) < 1e-6, `expected ~34.01, got ${r.lat}`);
  assert.strictEqual(r.lng, -118.0);
});

test("no providers agree => falls back to the first (most reliable) hit", () => {
  const r = location.pickIpConsensus([A, B, { lat: 0, lng: 0 }]);
  assert.strictEqual(r.lat, 40.0);
  assert.strictEqual(r.city, "Alpha");
});

console.log(`\n${passed} tests passed`);
