# OpenScout

OpenScout is a client-side lead finder for web designers and small agencies. It searches Google Maps for local businesses near a chosen location and filters for businesses that appear to have no real website.

The app is intentionally static: no backend, no database, no account system, and no hidden API key handling. The user's Google Maps API key stays in their own browser through `localStorage`.

## What It Does

- Saves a Google Maps API key locally in the browser.
- Searches any typed location or guessed current location.
- Lets users choose a business category from a searchable picker.
- Scans the area at Quick, Standard, or Deep depth.
- Filters for businesses with no website or only weak/social/directory web presence.
- Shows all leads in a continuous animated scroll list.
- Exports practical outreach fields to CSV.

## Run Locally

Open `index.html` directly in a browser, or serve the folder with any static file server.

```powershell
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Google Maps Setup

OpenScout needs a browser API key with these APIs enabled:

- Maps JavaScript API
- Places API
- Geocoding API

Restrict the key to your local or hosted URL, and restrict it to those APIs. The in-app guide at `methods.html` walks through the setup and scan-depth tradeoffs.

## Vanilla AnimatedList

This repo includes a dependency-free Vanilla JS port of React Bits' `AnimatedList` component in `js/animatedList.js`. It is used by the lead results renderer in `js/results.js`, so actual lead cards render as one continuous scroll list and animate with scale and opacity as they enter the results panel viewport. Gradients, selection, click handling, and keyboard navigation remain intact.

Declarative usage:

```html
<div data-animated-list data-display-scrollbar="false" data-initial-selected-index="0">
  <a data-animated-list-item data-meta="Home services" href="app.html#hunt">Roofers without websites</a>
  <a data-animated-list-item data-meta="Local services" href="app.html#hunt">Barbershops with only social links</a>
</div>

<script src="js/animatedList.js" defer></script>
```

Programmatic usage:

```html
<div id="leads"></div>
<script src="js/animatedList.js"></script>
<script>
  OpenScout.AnimatedList.create(document.querySelector("#leads"), {
    items: [
      { name: "Example Plumbing", address: "Austin, TX", leadType: "No website" },
      { name: "Example Auto Repair", address: "Chicago, IL", leadType: "No website" },
    ],
    showGradients: true,
    enableArrowNavigation: true,
    displayScrollbar: false,
    initialSelectedIndex: 0,
    renderItem: (lead) => {
      const card = document.createElement("article");
      card.className = "result-card";
      card.textContent = `${lead.name} - ${lead.address}`;
      return card;
    },
  });
</script>
```

Supported options mirror the React component where they make sense for Vanilla JS:

- `items`: array of strings or `{ label, meta, href }` objects.
- `showGradients`: toggles top and bottom fade overlays.
- `enableArrowNavigation`: enables ArrowUp, ArrowDown, Tab, Shift+Tab, and Enter selection.
- `className`: extra class for the container.
- `itemClassName`: extra class for every item button.
- `displayScrollbar`: shows or hides the scrollbar.
- `initialSelectedIndex`: selected row on load.
- `onItemSelect`: callback receiving `(item, index)`.
- `renderItem`: optional callback for rendering custom DOM, used by the lead cards.

## Project Notes

- Keep the app static and dependency-free unless a future change explicitly requires otherwise.
- Keep API keys in the browser only.
- Prefer small Vanilla JS modules in `js/`.
- Keep the UI focused on finding, reviewing, and exporting no-website leads.
