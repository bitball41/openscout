(function () {
  const mount = document.querySelector("[data-card-nav]");

  if (!mount) {
    return;
  }

  /* Nav content. Cards point at the planned Methods/About pages plus in-app
     anchors. Add per-item `bgColor` / `textColor` here to override the themed
     defaults from styles.css. */
  const items = [
    {
      label: "Methods",
      links: [
        {
          label: "Get a Google Maps API key",
          href: "methods.html#api-key",
          ariaLabel: "How to get a Google Maps API key",
        },
        {
          label: "Scan depth explained",
          href: "methods.html#scan-depth",
          ariaLabel: "How scan depth affects results",
        },
      ],
    },
    {
      label: "About",
      links: [
        {
          label: "What OpenScout does",
          href: "about.html",
          ariaLabel: "About OpenScout",
        },
        {
          label: "How leads are found",
          href: "about.html#filtering",
          ariaLabel: "How OpenScout decides a business is a lead",
        },
        {
          label: "Source on GitHub",
          href: "https://github.com/bitball41/openscout",
          icon: "github",
          ariaLabel: "OpenScout source on GitHub (open source)",
        },
      ],
    },
    {
      label: "Scan",
      links: [
        { label: "Start a scan", href: "app.html#hunt", ariaLabel: "Open the scan form" },
        { label: "View leads", href: "app.html#results", ariaLabel: "Open the results" },
      ],
    },
  ];

  const COLLAPSED_HEIGHT = 60;
  const DESKTOP_OPEN_HEIGHT = 260;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileQuery = window.matchMedia("(max-width: 768px)");

  let isExpanded = false;

  const arrowIcon =
    '<svg class="nav-card-link-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
    '<path fill="currentColor" d="M4.5 4h7v7h-2V7.41L4.7 12.2 3.3 10.8 8.09 6H4.5z"/></svg>';

  const githubIcon =
    '<svg class="nav-card-link-icon" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
    '<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38' +
    ' 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53' +
    '.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95' +
    ' 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09' +
    ' 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65' +
    ' 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

  function iconFor(name) {
    return name === "github" ? githubIcon : arrowIcon;
  }

  function escapeAttr(value) {
    return String(value == null ? "" : value).replace(/"/g, "&quot;");
  }

  function escapeText(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : value;
    return div.innerHTML;
  }

  function cardMarkup(item) {
    const links = (item.links || [])
      .map(
        (lnk) =>
          '<a class="nav-card-link" href="' +
          escapeAttr(lnk.href || "#") +
          '" aria-label="' +
          escapeAttr(lnk.ariaLabel || lnk.label) +
          '">' +
          iconFor(lnk.icon) +
          escapeText(lnk.label) +
          "</a>"
      )
      .join("");

    const style =
      (item.bgColor ? "background-color:" + escapeAttr(item.bgColor) + ";" : "") +
      (item.textColor ? "color:" + escapeAttr(item.textColor) + ";" : "");

    return (
      '<div class="nav-card"' +
      (style ? ' style="' + style + '"' : "") +
      ">" +
      '<div class="nav-card-label">' +
      escapeText(item.label) +
      "</div>" +
      '<div class="nav-card-links">' +
      links +
      "</div>" +
      "</div>"
    );
  }

  mount.innerHTML =
    '<div class="card-nav-container">' +
    '<nav class="card-nav">' +
    '<div class="card-nav-top">' +
    '<div class="hamburger-menu" role="button" tabindex="0" aria-label="Open menu" aria-expanded="false">' +
    '<span class="hamburger-line"></span>' +
    '<span class="hamburger-line"></span>' +
    "</div>" +
    '<div class="logo-container"><a class="card-nav-logo" href="index.html">OpenScout</a></div>' +
    '<a class="card-nav-cta-button" href="app.html">Start scanning</a>' +
    "</div>" +
    '<div class="card-nav-content" aria-hidden="true">' +
    items.slice(0, 3).map(cardMarkup).join("") +
    "</div>" +
    "</nav>" +
    "</div>";

  const nav = mount.querySelector(".card-nav");
  const hamburger = mount.querySelector(".hamburger-menu");
  const content = mount.querySelector(".card-nav-content");

  nav.style.height = COLLAPSED_HEIGHT + "px";

  /* Desktop is a fixed two-row layout (260px). On mobile the cards stack, so we
     measure the natural content height the way the original component did. */
  function calculateHeight() {
    if (!mobileQuery.matches) {
      return DESKTOP_OPEN_HEIGHT;
    }

    const prev = {
      visibility: content.style.visibility,
      pointerEvents: content.style.pointerEvents,
      position: content.style.position,
      height: content.style.height,
    };

    content.style.visibility = "visible";
    content.style.pointerEvents = "auto";
    content.style.position = "static";
    content.style.height = "auto";

    // Force layout before reading the measured height.
    void content.offsetHeight;
    const measured = content.scrollHeight;

    content.style.visibility = prev.visibility;
    content.style.pointerEvents = prev.pointerEvents;
    content.style.position = prev.position;
    content.style.height = prev.height;

    return COLLAPSED_HEIGHT + measured + 16;
  }

  function setOpen(open) {
    isExpanded = open;
    nav.classList.toggle("open", open);
    hamburger.classList.toggle("open", open);
    hamburger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    hamburger.setAttribute("aria-expanded", String(open));
    content.setAttribute("aria-hidden", String(!open));
    nav.style.height = (open ? calculateHeight() : COLLAPSED_HEIGHT) + "px";
  }

  function toggleMenu() {
    setOpen(!isExpanded);
  }

  hamburger.addEventListener("click", toggleMenu);
  hamburger.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMenu();
    }
  });

  // Close the menu after following a link so it doesn't linger over content.
  content.addEventListener("click", (event) => {
    if (event.target.closest(".nav-card-link")) {
      setOpen(false);
    }
  });

  // Keep the open height correct when the viewport (and layout) changes.
  window.addEventListener("resize", () => {
    if (isExpanded) {
      nav.style.height = calculateHeight() + "px";
    }
  });

  mount.dataset.ready = "true";
})();
