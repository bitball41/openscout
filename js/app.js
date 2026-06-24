(function () {
  const state = {
    leads: [],
    scanned: 0,
    lastQuery: "Ready",
    locationGuess: null,
    resultPage: 1,
  };
  const RESULTS_PAGE_SIZE = 8;
  const THEME_KEY = "voidScout.theme";

  // Minimum "pessimistic" loader time per scan depth, so a scan always feels
  // like real work even though the API usually returns in a second or two.
  const SCAN_DURATIONS = { quick: 3000, standard: 8000, deep: 18000 };
  const SCAN_STAGES = [
    "Mapping the search area…",
    "Finding businesses nearby…",
    "Pulling up their listings…",
    "Reading addresses & phone numbers…",
    "Checking each one for a website…",
    "Filtering out businesses with sites…",
    "Ranking your best leads…",
  ];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const selectors = {
    form: "[data-lead-form]",
    apiKey: "#api-key",
    saveKey: "[data-save-key]",
    guessLocation: "[data-guess-location]",
    keyStatus: "[data-key-status]",
    statusDot: ".status-dot",
    results: "[data-results]",
    exportCsv: "[data-export-csv]",
    message: "[data-message]",
    totalScanned: "[data-total-scanned]",
    leadCount: "[data-lead-count]",
    lastQuery: "[data-last-query]",
    businessPicker: "[data-business-picker]",
    businessSelect: "[data-business-select]",
    businessTrigger: "[data-business-trigger]",
    businessLabel: "[data-business-label]",
    businessMenu: "[data-business-menu]",
    businessSearch: "[data-business-search]",
    businessClear: "[data-business-clear]",
    businessOptions: "[data-business-options]",
    leadTally: "[data-lead-tally]",
    locationInput: 'input[name="location"]',
    locationSuggestions: "[data-location-suggestions]",
    resultsPager: "[data-results-pager]",
    resultsPageLabel: "[data-results-page-label]",
    resultsPrev: "[data-results-prev]",
    resultsNext: "[data-results-next]",
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const savedKey = VoidScout.storage.getApiKey();
    const apiInput = document.querySelector(selectors.apiKey);

    apiInput.value = savedKey;
    applyTheme(localStorage.getItem(THEME_KEY) || "dark");
    updateKeyStatus(Boolean(savedKey));
    bindEvents();
    initBusinessPicker();
    initLocationAutocomplete();
    revealOnScroll();
    updateStats();
  }

  function bindEvents() {
    document.querySelector(selectors.saveKey).addEventListener("click", saveApiKey);
    document.querySelector(selectors.guessLocation).addEventListener("click", () => guessLocation({ showErrors: true }));
    document.querySelector(selectors.form).addEventListener("submit", handleSearch);
    document.querySelector(selectors.exportCsv).addEventListener("click", handleExport);
    document.querySelector(selectors.resultsPrev).addEventListener("click", () => changeResultsPage(-1));
    document.querySelector(selectors.resultsNext).addEventListener("click", () => changeResultsPage(1));
    document.querySelectorAll('input[name="scanDepth"]').forEach((radio) => {
      radio.addEventListener("change", updateDepthHint);
    });
    updateDepthHint();
    guessLocation({ showErrors: false });
  }

  function updateDepthHint() {
    const hint = document.querySelector("[data-depth-hint]");
    const selected = document.querySelector('input[name="scanDepth"]:checked');

    if (!hint || !selected) {
      return;
    }

    const hints = {
      quick: "Quick scans a 2×2 grid (~4 API calls) — fastest and cheapest, fewer leads.",
      standard: "Standard scans a 3×3 grid (~9 API calls). A solid balance of coverage and quota use.",
      deep: "Deep scans a 5×5 grid (~25 API calls) — the most leads, but uses the most Google quota.",
    };

    hint.textContent = hints[selected.value] || hints.standard;
  }

  function applyTheme(theme) {
    const isLight = theme === "light";

    document.body.classList.toggle("light-mode", isLight);
  }

  function initBusinessPicker() {
    const picker = document.querySelector(selectors.businessPicker);
    const select = document.querySelector(selectors.businessSelect);
    const trigger = document.querySelector(selectors.businessTrigger);
    const label = document.querySelector(selectors.businessLabel);
    const menu = document.querySelector(selectors.businessMenu);
    const search = document.querySelector(selectors.businessSearch);
    const clear = document.querySelector(selectors.businessClear);
    const optionsWrap = document.querySelector(selectors.businessOptions);

    if (!picker || !select || !trigger || !menu || !search || !optionsWrap) {
      return;
    }

    // Move the modal to <body> so its position:fixed always resolves against
    // the viewport, never a transformed ancestor (e.g. the reveal animation).
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }

    const groups = Array.from(select.querySelectorAll("optgroup")).map((group) => ({
      label: group.label,
      options: Array.from(group.querySelectorAll("option")).map((option) => ({
        label: option.textContent.trim(),
        value: option.value,
      })),
    }));

    function renderOptions(filter = "") {
      const query = filter.trim().toLowerCase();
      optionsWrap.innerHTML = "";

      groups.forEach((group) => {
        const matches = group.options.filter((option) => {
          return !query || option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query);
        });

        if (!matches.length) {
          return;
        }

        const groupNode = document.createElement("section");
        groupNode.className = "business-group";

        const groupTitle = document.createElement("div");
        groupTitle.className = "business-group-title";
        groupTitle.textContent = group.label;

        const groupOptions = document.createElement("div");
        groupOptions.className = "business-group-options";

        matches.forEach((option) => {
          const button = document.createElement("button");
          button.className = "business-option";
          button.type = "button";
          button.role = "option";
          button.dataset.value = option.value;
          button.textContent = option.label;
          button.setAttribute("aria-selected", String(select.value === option.value));
          button.classList.toggle("is-selected", select.value === option.value);
          button.addEventListener("click", () => chooseBusiness(option));
          groupOptions.appendChild(button);
        });

        groupNode.append(groupTitle, groupOptions);
        optionsWrap.appendChild(groupNode);
      });

      if (!optionsWrap.children.length) {
        const empty = document.createElement("div");
        empty.className = "business-empty";
        empty.textContent = "No business types match that search.";
        optionsWrap.appendChild(empty);
      }
    }

    function chooseBusiness(option) {
      select.value = option.value;
      label.textContent = option.label;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeMenu();
    }

    function clearBusiness() {
      select.value = "";
      label.textContent = "Choose a business type";
      search.value = "";
      renderOptions();
      select.dispatchEvent(new Event("change", { bubbles: true }));
      search.focus();
    }

    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      renderOptions(search.value);
      requestAnimationFrame(() => search.focus());
    }

    function closeMenu() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", () => {
      if (menu.hidden) {
        openMenu();
      } else {
        closeMenu();
      }
    });

    search.addEventListener("input", () => renderOptions(search.value));
    clear.addEventListener("click", clearBusiness);

    const closeButton = document.querySelector("[data-business-close]");
    const backdrop = document.querySelector("[data-business-backdrop]");
    if (closeButton) {
      closeButton.addEventListener("click", closeMenu);
    }
    if (backdrop) {
      backdrop.addEventListener("click", closeMenu);
    }

    document.addEventListener("click", (event) => {
      if (!picker.contains(event.target) && !menu.contains(event.target)) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
        trigger.focus();
      }
    });

    renderOptions();
  }

  function saveApiKey() {
    const apiInput = document.querySelector(selectors.apiKey);
    const key = VoidScout.storage.setApiKey(apiInput.value);

    apiInput.value = key;
    updateKeyStatus(Boolean(key));
    showMessage(key ? "API key saved in this browser." : "Saved key removed.");
  }

  async function handleSearch(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);
    const apiKey = VoidScout.storage.setApiKey(data.get("apiKey"));
    const location = String(data.get("location") || "").trim();
    const businessType = String(data.get("businessType") || "").trim();
    const depth = String(data.get("scanDepth") || "standard");
    const useLocationGuess = state.locationGuess && location === state.locationGuess.label;

    updateKeyStatus(Boolean(apiKey));

    if (!apiKey || (!location && !useLocationGuess) || !businessType) {
      showMessage("Add an API key and business type. Use the guessed location or type a city manually.", true);
      return;
    }

    setLoading(true);
    hideMessage();
    const loader = startScanLoader(depth);

    try {
      const searchPromise = VoidScout.googlePlaces.searchLeads({
        apiKey,
        location,
        businessType,
        depth,
        locationGuess: useLocationGuess ? state.locationGuess : null,
      });

      // Wait for the real search AND the minimum loader time. If the search
      // rejects, Promise.all rejects immediately so errors are not delayed.
      const [result] = await Promise.all([searchPromise, sleep(loader.duration)]);

      state.leads = result.leads;
      state.scanned = result.scanned;
      state.lastQuery = `${businessType} / ${location || state.locationGuess.label}`;
      state.resultPage = 1;

      renderCurrentResults();
      VoidScout.results.renderAttributions(document.querySelector("[data-attributions]"), state.leads);
      updateStats();

      const leadCount = result.leads.length;
      const withSite = result.withWebsite || 0;
      const areas = result.tiles ? ` across ${result.tiles} areas` : "";
      const tail = withSite ? ` (${withSite} already had a real website)` : "";
      showMessage(
        leadCount
          ? `Found ${leadCount} lead${leadCount === 1 ? "" : "s"}${areas} from ${result.scanned} businesses scanned${tail}.`
          : `Scanned ${result.scanned} businesses${areas} — they all already have websites. Try another area, business type, or a deeper scan.`
      );
    } catch (error) {
      showMessage(error.message || "The scan failed. Check the API key and Places API access.", true);
    } finally {
      loader.stop();
      setLoading(false);
    }
  }

  function handleExport() {
    if (!state.leads.length) {
      showMessage("There are no leads to export yet.", true);
      return;
    }

    VoidScout.exporter.downloadLeadsCsv(state.leads);
  }

  function changeResultsPage(direction) {
    const totalPages = Math.max(1, Math.ceil(state.leads.length / RESULTS_PAGE_SIZE));
    state.resultPage = Math.min(totalPages, Math.max(1, state.resultPage + direction));
    renderCurrentResults();
    updateStats();
  }

  function renderCurrentResults() {
    VoidScout.results.renderResults(document.querySelector(selectors.results), state.leads, {
      page: state.resultPage,
      pageSize: RESULTS_PAGE_SIZE,
    });
  }

  async function guessLocation({ showErrors }) {
    const locationInput = document.querySelector('input[name="location"]');
    const guessButton = document.querySelector(selectors.guessLocation);
    const apiKey = VoidScout.storage.getApiKey() || document.querySelector(selectors.apiKey).value.trim();

    if (!VoidScout.location) {
      return;
    }

    guessButton.disabled = true;
    guessButton.textContent = "...";

    try {
      const coords = await VoidScout.location.getBrowserLocation();
      let label = VoidScout.location.formatCoordinates(coords);

      if (apiKey) {
        try {
          label = await VoidScout.googlePlaces.reverseGeocodeLocation(apiKey, coords) || label;
        } catch {
          label = VoidScout.location.formatCoordinates(coords);
        }
      }

      state.locationGuess = { ...coords, label };
      locationInput.value = label;
      locationInput.placeholder = "Location";
      showMessage(`Location guessed as ${label}.`);
    } catch (error) {
      state.locationGuess = null;
      locationInput.placeholder = "Austin, TX";
      if (showErrors) {
        showMessage(error.message, true);
      }
    } finally {
      guessButton.disabled = false;
      guessButton.textContent = "Guess";
    }
  }

  function initLocationAutocomplete() {
    const input = document.querySelector(selectors.locationInput);
    const suggestionsBox = document.querySelector(selectors.locationSuggestions);
    let sessionToken = null;
    let debounceTimer = null;
    let requestId = 0;

    if (!input || !suggestionsBox) {
      return;
    }

    input.addEventListener("input", () => {
      state.locationGuess = null;
      clearTimeout(debounceTimer);

      const query = input.value.trim();
      if (query.length < 2) {
        hideLocationSuggestions();
        return;
      }

      debounceTimer = setTimeout(() => fetchSuggestions(query), 240);
    });

    input.addEventListener("focus", () => {
      if (suggestionsBox.children.length && input.value.trim().length >= 2) {
        suggestionsBox.hidden = false;
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideLocationSuggestions();
      }
    });

    document.addEventListener("click", (event) => {
      if (!suggestionsBox.contains(event.target) && event.target !== input) {
        hideLocationSuggestions();
      }
    });

    async function fetchSuggestions(query) {
      const apiKey = VoidScout.storage.getApiKey() || document.querySelector(selectors.apiKey).value.trim();
      const currentRequest = ++requestId;

      if (!apiKey) {
        renderLocationMessage("Save your API key to enable location suggestions.");
        return;
      }

      try {
        sessionToken = sessionToken || null;
        const suggestions = await VoidScout.googlePlaces.getLocationSuggestions({
          apiKey,
          input: query,
          sessionToken,
        });

        if (currentRequest !== requestId) {
          return;
        }

        sessionToken = suggestions[0]?.sessionToken || sessionToken;
        renderLocationSuggestions(suggestions);
      } catch (error) {
        if (currentRequest === requestId) {
          renderLocationMessage("Location suggestions are unavailable. You can still type a place manually.");
        }
      }
    }

    function renderLocationSuggestions(suggestions) {
      suggestionsBox.innerHTML = "";

      if (!suggestions.length) {
        renderLocationMessage("No matching locations found.");
        return;
      }

      suggestions.forEach((suggestion) => {
        const button = document.createElement("button");
        button.className = "location-suggestion";
        button.type = "button";
        button.innerHTML = `
          <strong></strong>
          <small></small>
        `;
        button.querySelector("strong").textContent = suggestion.mainText;
        button.querySelector("small").textContent = suggestion.secondaryText;
        button.addEventListener("click", () => {
          input.value = suggestion.label;
          state.locationGuess = null;
          sessionToken = null;
          hideLocationSuggestions();
        });
        suggestionsBox.appendChild(button);
      });

      suggestionsBox.hidden = false;
    }

    function renderLocationMessage(message) {
      suggestionsBox.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "location-suggestion-empty";
      empty.textContent = message;
      suggestionsBox.appendChild(empty);
      suggestionsBox.hidden = false;
    }

    function hideLocationSuggestions() {
      suggestionsBox.hidden = true;
    }
  }

  function updateKeyStatus(hasKey) {
    const status = document.querySelector(selectors.keyStatus);
    const dot = document.querySelector(selectors.statusDot);

    status.textContent = hasKey ? "Key saved locally" : "No saved key";
    dot.classList.toggle("ready", hasKey);
  }

  function updateStats() {
    setTextIfPresent(selectors.totalScanned, state.scanned);
    setTextIfPresent(selectors.leadCount, state.leads.length);
    setTextIfPresent(selectors.lastQuery, state.lastQuery);
    document.querySelector(selectors.exportCsv).disabled = state.leads.length === 0;
    updateLeadTally();
    updateResultsPager();
  }

  function updateLeadTally() {
    const tally = document.querySelector(selectors.leadTally);

    if (!tally) {
      return;
    }

    const total = state.leads.length;
    tally.hidden = total === 0;
    tally.textContent = total ? `${total} lead${total === 1 ? "" : "s"} found` : "";
  }

  function updateResultsPager() {
    const pager = document.querySelector(selectors.resultsPager);
    const label = document.querySelector(selectors.resultsPageLabel);
    const prev = document.querySelector(selectors.resultsPrev);
    const next = document.querySelector(selectors.resultsNext);
    const total = state.leads.length;
    const totalPages = Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE));
    const start = total ? (state.resultPage - 1) * RESULTS_PAGE_SIZE + 1 : 0;
    const end = Math.min(total, state.resultPage * RESULTS_PAGE_SIZE);

    pager.hidden = total <= RESULTS_PAGE_SIZE;
    label.textContent = total ? `${start}-${end} of ${total}` : "";
    prev.disabled = state.resultPage <= 1;
    next.disabled = state.resultPage >= totalPages;
  }

  function setTextIfPresent(selector, value) {
    const node = document.querySelector(selector);

    if (node) {
      node.textContent = value;
    }
  }

  function setLoading(isLoading) {
    const button = document.querySelector(".scan-button");

    button.disabled = isLoading;
    button.innerHTML = isLoading ? "<span aria-hidden=\"true\">⌁</span> Scanning" : "<span aria-hidden=\"true\">⌕</span> Scan";
  }

  function showMessage(message, isError = false) {
    const box = document.querySelector(selectors.message);

    box.hidden = false;
    box.textContent = message;
    box.classList.toggle("error", isError);
  }

  function hideMessage() {
    const box = document.querySelector(selectors.message);

    if (box) {
      box.hidden = true;
    }
  }

  // Builds the staged "pessimistic" loader: a spinner, a cycling stage label, a
  // checklist that ticks off, and a bar that fills over the depth's duration.
  // Returns { duration, stop } — the caller waits at least `duration` ms.
  function startScanLoader(depth) {
    const loader = document.querySelector("[data-scan-loader]");
    const stageEl = document.querySelector("[data-loader-stage]");
    const stepsEl = document.querySelector("[data-loader-steps]");
    const barEl = document.querySelector("[data-loader-bar]");
    const duration = SCAN_DURATIONS[depth] || SCAN_DURATIONS.standard;

    if (!loader || !stageEl || !stepsEl || !barEl) {
      return { duration, stop() {} };
    }

    stepsEl.replaceChildren();
    const steps = SCAN_STAGES.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      stepsEl.appendChild(li);
      return li;
    });

    function paint(active) {
      steps.forEach((li, index) => {
        li.classList.toggle("is-done", index < active);
        li.classList.toggle("is-active", index === active);
      });
      stageEl.textContent = SCAN_STAGES[Math.min(active, SCAN_STAGES.length - 1)];
    }

    loader.hidden = false;
    paint(0);

    // Fill the progress bar across the whole duration (reset transition first).
    barEl.style.transition = "none";
    barEl.style.width = "0%";
    void barEl.offsetWidth;
    barEl.style.transition = `width ${duration}ms linear`;
    barEl.style.width = "100%";

    let active = 0;
    const interval = setInterval(() => {
      active += 1;
      if (active >= SCAN_STAGES.length - 1) {
        paint(SCAN_STAGES.length - 1);
        clearInterval(interval);
        return;
      }
      paint(active);
    }, duration / SCAN_STAGES.length);

    return {
      duration,
      stop() {
        clearInterval(interval);
        loader.hidden = true;
        stepsEl.replaceChildren();
      },
    };
  }

  function revealOnScroll() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );

    document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
  }
})();
