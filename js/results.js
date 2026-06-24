(function () {
  function renderResults(container, leads, options = {}) {
    const page = options.page || 1;
    const pageSize = options.pageSize || leads.length || 1;
    const visibleLeads = leads.slice((page - 1) * pageSize, page * pageSize);

    container.innerHTML = "";

    if (!leads.length) {
      container.appendChild(createEmptyState());
      return;
    }

    visibleLeads.forEach((lead, index) => {
      container.appendChild(createLeadCard(lead, index));
    });
  }

  function createLeadCard(lead, index) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.style.animationDelay = `${index * 40}ms`;

    // Header: name + lead-type badge (green = no site, amber = weak/social site).
    const head = document.createElement("div");
    head.className = "result-head";

    const name = document.createElement("h3");
    name.className = "result-name";
    name.textContent = lead.name;

    const badge = document.createElement("span");
    badge.className = lead.leadTier === "weak" ? "badge is-weak" : "badge";
    badge.textContent = lead.leadType || "No website";

    head.append(name, badge);
    card.appendChild(head);

    // Rating line, only when Google actually has rating data.
    if (lead.rating) {
      const rating = document.createElement("p");
      rating.className = "result-rating";
      const reviews = lead.ratingCount ? ` · ${lead.ratingCount} review${lead.ratingCount === 1 ? "" : "s"}` : "";
      rating.innerHTML = `<span class="stars">★</span> ${lead.rating}${reviews}`;
      card.appendChild(rating);
    }

    // Detail rows.
    const meta = document.createElement("dl");
    meta.className = "result-meta";
    meta.appendChild(metaRow("Address", lead.address || "Not listed"));
    meta.appendChild(metaRow("Phone", lead.phone || "Not listed"));
    if (lead.weakLink) {
      meta.appendChild(metaRow("Found", linkNode(lead.weakLink, shortenUrl(lead.weakLink))));
    }
    card.appendChild(meta);

    // Footer: maps link + temporary-closure flag.
    const foot = document.createElement("div");
    foot.className = "result-foot";

    if (lead.googleMapsURL) {
      foot.appendChild(linkNode(lead.googleMapsURL, "Open on Google Maps", "maps-link"));
    } else {
      foot.appendChild(document.createElement("span"));
    }

    if (lead.businessStatus && lead.businessStatus !== "OPERATIONAL") {
      const flag = document.createElement("span");
      flag.className = "status-flag";
      flag.textContent = lead.businessStatus === "CLOSED_TEMPORARILY" ? "Temp. closed" : "Check status";
      foot.appendChild(flag);
    }

    card.appendChild(foot);
    return card;
  }

  function metaRow(label, value) {
    const row = document.createElement("div");
    row.className = "meta-row";

    const dt = document.createElement("dt");
    dt.textContent = label;

    const dd = document.createElement("dd");
    if (value instanceof Node) {
      dd.appendChild(value);
    } else {
      dd.textContent = value;
    }

    row.append(dt, dd);
    return row;
  }

  function linkNode(href, text, className) {
    const link = document.createElement("a");
    if (className) {
      link.className = className;
    }
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = text;
    return link;
  }

  function shortenUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function createEmptyState() {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.innerHTML = `
      <span>⌁</span>
      <h3>No matching leads</h3>
      <p>Try a broader business type, a nearby city, or another neighborhood.</p>
    `;
    return empty;
  }

  function renderAttributions(container, leads) {
    const attributionMap = new Map();

    leads.forEach((lead) => {
      (lead.attributions || []).forEach((attribution) => {
        const key = `${attribution.provider}|${attribution.providerURI}`;
        attributionMap.set(key, attribution);
      });
    });

    container.innerHTML = "";
    container.hidden = attributionMap.size === 0;

    if (!attributionMap.size) {
      return;
    }

    const label = document.createElement("span");
    label.textContent = "Place data attributions: ";
    container.appendChild(label);

    Array.from(attributionMap.values()).forEach((attribution, index) => {
      if (index) {
        container.appendChild(document.createTextNode(", "));
      }

      if (attribution.providerURI) {
        const link = document.createElement("a");
        link.href = attribution.providerURI;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = attribution.provider;
        container.appendChild(link);
      } else {
        container.appendChild(document.createTextNode(attribution.provider));
      }
    });
  }

  window.OpenScout = window.OpenScout || {};
  window.OpenScout.results = {
    renderResults,
    renderAttributions,
  };
})();
