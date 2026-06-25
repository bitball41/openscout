"use strict";

// Unit tests for OpenScout's pure accuracy logic (classification, confidence
// scoring, and the live-verification decision table). Run with: node test/classify.test.js
const assert = require("assert");
const classify = require("../js/classify.js");
const verify = require("../js/verify.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("classifyWebsite");

test("empty website is a no-website lead", () => {
  const r = classify.classifyWebsite("");
  assert.strictEqual(r.isLead, true);
  assert.strictEqual(r.category, "none");
  assert.strictEqual(r.tier, "none");
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

test("linktree is a link-in-bio lead", () => {
  assert.strictEqual(classify.classifyWebsite("https://linktr.ee/x").category, "linkbio");
});

test("yelp is a directory lead", () => {
  assert.strictEqual(classify.classifyWebsite("https://www.yelp.com/biz/x").category, "directory");
});

test("free builder subdomain is a builder lead", () => {
  assert.strictEqual(classify.classifyWebsite("https://abc.wixsite.com/site").category, "builder");
  assert.strictEqual(classify.classifyWebsite("https://business.site/").category, "builder");
});

test("parked domain is flagged", () => {
  assert.strictEqual(classify.classifyWebsite("https://sedoparking.com/foo").category, "parked");
  assert.strictEqual(classify.classifyWebsite("https://example.secureserver.net/").category, "parked");
});

test("a real custom domain is not a lead", () => {
  const r = classify.classifyWebsite("https://www.joesrealbakery.com");
  assert.strictEqual(r.isLead, false);
  assert.strictEqual(r.category, "real");
});

test("hostOf strips www and protocol", () => {
  assert.strictEqual(classify.hostOf("https://www.Example.com/path"), "example.com");
  assert.strictEqual(classify.hostOf("Example.org"), "example.org");
});

console.log("scoreLead");

test("established no-website business scores very high", () => {
  const place = { ratingCount: 40, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite(""), null);
  assert.strictEqual(s.isLead, true);
  assert.ok(s.confidence >= 90, `expected >=90, got ${s.confidence}`);
});

test("zero-review no-website listing is penalised", () => {
  const place = { ratingCount: 0, phone: "", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite(""), null);
  assert.ok(s.confidence < 75, `expected <75, got ${s.confidence}`);
});

test("real site verified dead becomes a lead", () => {
  const place = { ratingCount: 10, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite("https://deadbiz.com"), { state: "dead", probes: 2 });
  assert.strictEqual(s.isLead, true);
  assert.strictEqual(s.category, "dead");
  assert.ok(s.confidence >= 80, `expected >=80, got ${s.confidence}`);
});

test("real site verified live stays a non-lead", () => {
  const place = { ratingCount: 10, phone: "555", businessStatus: "OPERATIONAL" };
  const s = classify.scoreLead(place, classify.classifyWebsite("https://livebiz.com"), { state: "live", probes: 1 });
  assert.strictEqual(s.isLead, false);
});

test("confidence is clamped to [40,99]", () => {
  const place = { ratingCount: 0, phone: "", businessStatus: "CLOSED_TEMPORARILY" };
  const s = classify.scoreLead(place, classify.classifyWebsite(""), null);
  assert.ok(s.confidence >= 40 && s.confidence <= 99);
});

console.log("verify.interpretProbes");

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

console.log("verify.normalizeForProbe");

test("adds https when missing", () => {
  assert.strictEqual(verify.normalizeForProbe("example.com"), "https://example.com");
  assert.strictEqual(verify.normalizeForProbe("http://example.com"), "http://example.com");
  assert.strictEqual(verify.normalizeForProbe(""), "");
});

console.log(`\n${passed} tests passed`);
