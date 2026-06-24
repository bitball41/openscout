(function () {
  function renderResults(container, leads, options = {}) {
    const page = options.page || 1;
    const pageSize = options.pageSize || leads.length || 1;
    const visibleLeads = leads.slice((page - 1) * pageSize, page * pageSize);

    container.innerHTML = "";
    container.classList.toggle("has-results", leads.length > 0);

    if (!leads.length) {
      container.removeAttribute("role");
      container.removeAttribute("tabindex");
      container.removeAttribute("aria-label");
      container.appendChild(createEmptyState());
      return;
    }

    container.tabIndex = 0;
    container.setAttribute("role", "listbox");
    container.setAttribute("aria-label", "Lead results");

    visibleLeads.forEach((lead, index) => {
      container.appendChild(createLeadCard(lead, index, page, pageSize));
    });

    initAnimatedList(container);
  }

  function createLeadCard(lead, index, page, pageSize) {
    const absoluteIndex = (page - 1) * pageSize + index;
    const card = document.createElement("article");
    card.className = "result-card";
    card.dataset.index = String(index);
    card.setAttribute("role", "option");
    card.tabIndex = -1;
    card.setAttribute("aria-selected", index === 0 ? "true" : "false");
    card.style.setProperty("--item-index", index);
    card.style.animationDelay = `${index * 55}ms`;

    const rank = document.createElement("div");
    rank.className = "result-rank";
    rank.textContent = String(absoluteIndex + 1).padStart(2, "0");

    const body = document.createElement("div");
    body.className = "result-body";

    const summary = document.createElement("div");
    summary.className = "result-summary";

    const name = document.createElement("h3");
    name.className = "result-name";
    name.textContent = lead.name;

    const badge = document.createElement("span");
    badge.className = lead.leadTier === "weak" ? "badge is-weak" : "badge";
    badge.textContent = lead.leadType || "No website";

    summary.append(name, badge);
    body.appendChild(summary);

    const insight = document.createElement("div");
    insight.className = "result-insight";

    const address = document.createElement("span");
    address.textContent = lead.address || "Address not listed";
    insight.appendChild(address);

    if (lead.rating) {
      const rating = document.createElement("span");
      rating.className = "result-rating";
      const reviews = lead.ratingCount ? ` / ${lead.ratingCount} review${lead.ratingCount === 1 ? "" : "s"}` : "";
      rating.textContent = `* ${lead.rating}${reviews}`;
      insight.appendChild(rating);
    }
    body.appendChild(insight);

    const meta = document.createElement("dl");
    meta.className = "result-meta";
    meta.appendChild(metaRow("Phone", lead.phone || "Not listed"));
    if (lead.weakLink) {
      meta.appendChild(metaRow("Found", linkNode(lead.weakLink, shortenUrl(lead.weakLink))));
    }
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    if (lead.googleMapsURL) {
      actions.appendChild(linkNode(lead.googleMapsURL, "Maps", "maps-link"));
    }

    if (lead.businessStatus && lead.businessStatus !== "OPERATIONAL") {
      const flag = document.createElement("span");
      flag.className = "status-flag";
      flag.textContent = lead.businessStatus === "CLOSED_TEMPORARILY" ? "Temp. closed" : "Check status";
      actions.appendChild(flag);
    }

    card.append(rank, body, actions);
    return card;
  }

  function initAnimatedList(container) {
    const cards = Array.from(container.querySelectorAll(".result-card"));
    let selectedIndex = 0;

    function select(index, options = {}) {
      selectedIndex = Math.max(0, Math.min(cards.length - 1, index));
      cards.forEach((card, cardIndex) => {
        const isSelected = cardIndex === selectedIndex;
        card.classList.toggle("is-selected", isSelected);
        card.setAttribute("aria-selected", String(isSelected));
        card.tabIndex = isSelected ? 0 : -1;
      });

      const selected = cards[selectedIndex];
      if (options.focus && selected) {
        selected.focus({ preventScroll: true });
      }
      if (options.scroll && selected) {
        selected.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    cards.forEach((card, index) => {
      card.addEventListener("mouseenter", () => select(index));
      card.addEventListener("focus", () => select(index));
      card.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
          return;
        }
        select(index, { focus: true });
      });
    });

    container.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
        return;
      }

      event.preventDefault();
      const nextIndex = {
        ArrowDown: selectedIndex + 1,
        ArrowUp: selectedIndex - 1,
        Home: 0,
        End: cards.length - 1,
      }[event.key];
      select(nextIndex, { focus: true, scroll: true });
    });

    select(0);
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
      <span>*</span>
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
