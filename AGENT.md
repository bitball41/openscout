# OpenScout Agent Brief

## Product Intent

OpenScout is supposed to be a minimal, client-side lead-hunting web app for web designers and small agencies. Its job is to help users find local businesses that appear on Google Maps but do not have a website listed, so those businesses can become prospects for web design outreach.

This is not meant to be a marketing site, CRM, scraper backend, or sales automation platform. It should feel like a focused utility: enter a key, choose a place and business type, scan, review leads, export CSV.

## Core Promise

Find businesses near a chosen location that are missing website data.

The user should be able to:

- Enter and save their own Google Maps API key locally.
- Search any location, not only their current location.
- Use Google-style autocomplete for locations.
- Choose a business category from a practical list.
- See only businesses that do not have a website listed.
- Export the visible lead data to CSV.

## Non-Negotiable Constraints

- 100% client-side.
- No backend.
- No server-side proxy.
- No database.
- No account system.
- No hidden API key handling.
- The user's Google Maps API key must remain in the browser, stored only in `localStorage`.
- Do not add build tooling unless explicitly requested.
- The app should remain runnable as static files.

## UX Direction

The intended interface is minimal and tool-like.

Preferred layout:

- Full viewport app.
- No page scroll.
- Inputs on the left.
- Results on the right.
- Results should paginate or otherwise fit the panel without forcing page scroll.
- The business category picker should avoid long scrolling when possible: show common categories first, then allow search.
- The location input should support both typed manual locations and API-powered autocomplete suggestions.
- Current-location guessing is a convenience, not a requirement for search.

Visual feel:

- Dark, clean, restrained.
- Black background with subtle motion or texture.
- No heavy marketing sections.
- No large explanatory blocks.
- No extra top navigation unless there is a real product need.
- Keep controls compact but readable.

## API Behavior

Use the user's Google Maps API key directly from the browser.

Expected API usage:

- Maps JavaScript API loading with the user's key.
- Places search for business discovery.
- Places autocomplete for location suggestions.
- Geocoding to turn the chosen location into coordinates for area scanning.
- Optional reverse geocoding for current-location labels.

Result-count strategy:

- Google Text Search returns at most 20 results per request and the JS SDK
  exposes no pagination token, so the app cannot get more than 20 from a single
  query. To find more leads it tiles the search area into an N x N grid (chosen
  by the "Scan depth" control) and runs one `searchByText` per tile with a
  `locationRestriction` rectangle, then dedupes by place id.
- Tiling is adaptive: a tile that returns the full 20 results is "saturated"
  (hiding businesses) and is split into a 2x2 of sub-tiles that are searched in
  turn, up to a per-depth tile budget. This sharply reduces missed businesses in
  dense areas while keeping quota predictable.
- Tiling multiplies API calls per scan (roughly grid^2, more where it
  subdivides). The depth control keeps this in the user's hands; default to a
  modest grid and stay honest about cost.

Filtering rule (see `js/classify.js` and `js/verify.js`):

- A business is a lead if it has no *real* website of its own. A page that only
  lives on a social network, a directory, a link-in-bio page, a booking/ordering
  platform, a marketplace storefront, a Google profile, or a free site-builder
  subdomain (`*.wixsite.com`, `business.site`, etc.) still counts as a lead. A
  custom domain reads as a real website. Permanently closed businesses are
  excluded.
- Listed "real" websites are live-checked from the browser; ones that fail at
  the network level (dead/parked domains) are reclassified as leads.
- Every lead carries a confidence score (classification certainty + live-check
  result + establishment signals). The app reports the mean as an estimated
  accuracy, and a Match-precision control filters the least-confident leads so
  the surfaced set stays high-precision.

The app should be honest about Google API limits, billing, key restrictions, and permission failures. If autocomplete or geolocation is unavailable, manual typing should still work.

Allowed external calls (still no backend, no proxy):

- Live website verification contacts each target site directly from the user's
  browser — exactly as if the user clicked the link. No third-party relay.
- Current-location guessing uses precise GPS first; if that is blocked it may
  fall back to a free, no-key IP-geolocation service for a coarse city estimate.
  This is the only non-Google request and sends nothing but the request itself.

## Data Shown For Each Lead

At minimum:

- Business name
- Address
- Phone, if available
- Rating, if available
- Review count, if available
- Google Maps link, if available
- Clear lead-type badge (No website / Social only / Directory only / Website offline / …)
- Confidence chip with the reasons behind the score (hover/title)

CSV export should include the same practical outreach fields, plus confidence, web status, and coordinates.

## Maintenance Guidance

When modifying this app:

- Preserve the client-side-only design.
- Keep HTML, CSS, and JS separated.
- Prefer small vanilla JS modules over framework rewrites.
- Avoid adding dependencies for simple UI behavior.
- Keep accessibility basics: labels, buttons, focus states, keyboard escape/close behavior.
- Test in the browser after UI changes.
- Do not optimize for feature count over clarity.

## What This Should Not Become

Avoid turning OpenScout into:

- A general Google Maps clone.
- A cold email sender.
- A CRM.
- A lead database.
- A backend scraping service.
- A dashboard full of analytics.
- A landing page with decorative sections.

If a future feature does not help the user find and export no-website business leads faster, it probably does not belong.
