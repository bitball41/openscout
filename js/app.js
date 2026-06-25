(function () {
  const state = {
    leads: [],
    locationGuess: null,
  };

  // Minimum "pessimistic" loader time per scan depth, so a scan always feels
  // like real work even though the API usually returns in a second or two.
  const SCAN_DURATIONS = { quick: 3000, standard: 8000, deep: 18000 };
  const SCAN_STAGES = [
    "Mapping the search area…",
    "Finding businesses nearby…",
    "Pulling up their listings…",
    "Reading addresses & phone numbers…",
    "Checking each one for a website…",
    "Verifying which sites are actually live…",
    "Scoring confidence & ranking leads…",
  ];

  // Match precision → minimum per-lead confidence. Stricter modes drop the
  // guesses the classifier is least sure about, lowering the estimated mistake
  // rate at the cost of a few borderline leads.
  const PRECISION_CONFIDENCE = { strict: 88, balanced: 80, all: 0 };
  const DEFAULT_PRECISION = "balanced";
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
    accuracySummary: "[data-accuracy-summary]",
    verifyToggle: 'input[name="verifySites"]',
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const savedKey = OpenScout.storage.getApiKey();
    const apiInput = document.querySelector(selectors.apiKey);

    apiInput.value = savedKey;
    updateKeyStatus(Boolean(savedKey));
    bindEvents();
    initBusinessPicker();
    initLocationAutocomplete();
    hydrateSavedLocationGuess();
    refreshLocationIfAlreadyGranted();
    revealOnScroll();
    updateStats();
  }

  function bindEvents() {
    document.querySelector(selectors.saveKey).addEventListener("click", saveApiKey);
    document.querySelector(selectors.guessLocation).addEventListener("click", () => guessLocation({ showErrors: true }));
    document.querySelector(selectors.form).addEventListener("submit", handleSearch);
    document.querySelector(selectors.exportCsv).addEventListener("click", handleExport);
    document.querySelectorAll('input[name="scanDepth"]').forEach((radio) => {
      radio.addEventListener("change", updateDepthHint);
    });
    updateDepthHint();
  }

  function updateDepthHint() {
    const hint = document.querySelector("[data-depth-hint]");
    const selected = document.querySelector('input[name="scanDepth"]:checked');

    if (!hint || !selected) {
      return;
    }

    const hints = {
      quick: "Quick starts from a 2×2 grid (~4+ calls), auto-splitting only the busiest cells. Fastest and cheapest.",
      standard: "Standard starts from a 3×3 grid (~9+ calls) and drills into dense areas. A solid balance of coverage and quota.",
      deep: "Deep starts from a 5×5 grid (~25+ calls), splitting saturated cells for the fullest coverage — uses the most quota.",
    };

    hint.textContent = hints[selected.value] || hints.standard;
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
      label.textContent = "Any local business";
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
    const key = OpenScout.storage.setApiKey(apiInput.value);

    apiInput.value = key;
    updateKeyStatus(Boolean(key));
    showMessage(key ? "API key saved in this browser." : "Saved key removed.");
  }

  async function handleSearch(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);
    const apiKey = OpenScout.storage.setApiKey(data.get("apiKey"));
    const location = String(data.get("location") || "").trim();
    const businessType = String(data.get("businessType") || "").trim();
    const depth = String(data.get("scanDepth") || "standard");
    const precision = String(data.get("precision") || DEFAULT_PRECISION);
    const minConfidence = PRECISION_CONFIDENCE[precision] ?? PRECISION_CONFIDENCE.balanced;
    const verifyEl = document.querySelector(selectors.verifyToggle);
    const verify = verifyEl ? verifyEl.checked : true;
    const useLocationGuess = state.locationGuess && location === state.locationGuess.label;

    updateKeyStatus(Boolean(apiKey));

    if (!apiKey || (!location && !useLocationGuess)) {
      showMessage("Add an API key and location. Use Guess or type a city manually.", true);
      return;
    }

    setLoading(true);
    hideMessage();
    clearAccuracySummary();
    const loader = startScanLoader(depth);

    try {
      const searchPromise = OpenScout.googlePlaces.searchLeads({
        apiKey,
        location,
        businessType,
        depth,
        minConfidence,
        verify,
        locationGuess: useLocationGuess ? state.locationGuess : null,
        onProgress: (progress) => loader.note(formatProgress(progress)),
      });

      // Wait for the real search AND the minimum loader time. If the search
      // rejects, Promise.all rejects immediately so errors are not delayed.
      const [result] = await Promise.all([searchPromise, sleep(loader.duration)]);

      state.leads = result.leads;

      renderCurrentResults();
      OpenScout.results.renderAttributions(document.querySelector("[data-attributions]"), state.leads);
      renderAccuracySummary(result);
      updateStats();
      showMessage(buildResultMessage(result));
    } catch (error) {
      showMessage(error.message || "The scan failed. Check the API key and Places API access.", true);
    } finally {
      loader.stop();
      setLoading(false);
    }
  }

  function buildResultMessage(result) {
    const leadCount = result.leads.length;
    const areas = result.tiles ? ` across ${result.tiles} areas` : "";
    const failedTiles = result.failedTiles || 0;
    const failedNote = failedTiles
      ? ` (${failedTiles} of ${result.tiles} areas failed — results may be incomplete; check your API quota.)`
      : "";

    if (!leadCount) {
      const hiddenOnly = result.hiddenLowConfidence
        ? ` ${result.hiddenLowConfidence} low-confidence match${result.hiddenLowConfidence === 1 ? " was" : "es were"} filtered out — switch precision to "All" to see them.`
        : "";
      return `Scanned ${result.scanned} businesses${areas} — none cleared the bar.${hiddenOnly} Try another area, business type, or a deeper scan.${failedNote}`;
    }

    const withSite = result.withWebsite || 0;
    const tail = withSite ? ` (${withSite} already had a real website)` : "";
    const verified = result.verified ? ` Live-checked ${result.verified} site${result.verified === 1 ? "" : "s"}.` : "";
    const hidden = result.hiddenLowConfidence
      ? ` ${result.hiddenLowConfidence} lower-confidence lead${result.hiddenLowConfidence === 1 ? "" : "s"} hidden.`
      : "";
    return `Found ${leadCount} lead${leadCount === 1 ? "" : "s"}${areas} from ${result.scanned} businesses scanned${tail}.${verified}${hidden}${failedNote}`;
  }

  function formatProgress(progress) {
    if (!progress) return "";
    if (progress.phase === "verify") {
      return `Verifying live websites… ${progress.completed}/${progress.total}`;
    }
    const leads = Number.isFinite(progress.leads) ? ` · ${progress.leads} candidates` : "";
    return `Scanning area ${progress.completed}/${progress.total}${leads}`;
  }

  function renderAccuracySummary(result) {
    const box = document.querySelector(selectors.accuracySummary);
    if (!box) return;

    if (!result.leads.length || !result.estimatedAccuracy) {
      clearAccuracySummary();
      return;
    }

    const accuracy = result.estimatedAccuracy;
    const mistakes = result.estimatedMistakeRate;
    box.hidden = false;
    box.innerHTML = "";

    const label = document.createElement("span");
    label.className = "accuracy-label";
    label.textContent = "Estimated accuracy";

    const value = document.createElement("strong");
    value.className = `accuracy-value ${accuracy >= 90 ? "is-strong" : accuracy >= 78 ? "is-good" : "is-fair"}`;
    value.textContent = `${accuracy}%`;

    const meter = document.createElement("span");
    meter.className = "accuracy-meter";
    const fill = document.createElement("span");
    fill.className = "accuracy-meter-fill";
    fill.style.width = `${accuracy}%`;
    meter.appendChild(fill);

    const note = document.createElement("span");
    note.className = "accuracy-note";
    note.textContent = `~${mistakes}% may be off${result.verified ? ` · ${result.verified} live-checked` : ""}`;

    box.append(label, value, meter, note);
  }

  function clearAccuracySummary() {
    const box = document.querySelector(selectors.accuracySummary);
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
  }

  function handleExport() {
    if (!state.leads.length) {
      showMessage("There are no leads to export yet.", true);
      return;
    }

    OpenScout.exporter.downloadLeadsCsv(state.leads);
  }

  function renderCurrentResults() {
    OpenScout.results.renderResults(document.querySelector(selectors.results), state.leads);
  }

  async function guessLocation({ showErrors }) {
    const locationInput = document.querySelector('input[name="location"]');
    const guessButton = document.querySelector(selectors.guessLocation);
    const apiKey = OpenScout.storage.getApiKey() || document.querySelector(selectors.apiKey).value.trim();

    if (!OpenScout.location) {
      return;
    }

    guessButton.disabled = true;
    guessButton.textContent = "...";

    try {
      const { coords, approximate } = await resolveCurrentCoords();
      let label = approximate && coords.label ? coords.label : OpenScout.location.formatCoordinates(coords);

      if (apiKey) {
        try {
          label = await OpenScout.googlePlaces.reverseGeocodeLocation(apiKey, coords) || label;
          if (approximate) {
            label = `${label} (approx.)`;
          }
        } catch {
          label = approximate && coords.label ? coords.label : OpenScout.location.formatCoordinates(coords);
        }
      }

      state.locationGuess = { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy, label };
      OpenScout.storage.setLocationGuess(state.locationGuess);
      locationInput.value = label;
      locationInput.placeholder = "Location";
      const precision = Number.isFinite(coords.accuracy)
        ? approximate
          ? " (approximate, from network)"
          : ` (±${Math.round(coords.accuracy)}m)`
        : "";
      showMessage(`Location guessed as ${label}${precision}.`);
    } catch (error) {
      locationInput.placeholder = "Austin, TX";
      if (showErrors) {
        if (!locationInput.value.trim()) {
          state.locationGuess = null;
        }
        showMessage(error.message, true);
      }
    } finally {
      guessButton.disabled = false;
      guessButton.textContent = "Guess";
    }
  }

  // Try precise GPS first; fall back to coarse IP geolocation if GPS is denied
  // or unavailable so "Guess" still gives a usable starting point.
  async function resolveCurrentCoords() {
    try {
      const coords = await OpenScout.location.getBrowserLocation();
      return { coords, approximate: false };
    } catch (gpsError) {
      if (typeof OpenScout.location.getApproximateLocationByIp === "function") {
        try {
          const coords = await OpenScout.location.getApproximateLocationByIp();
          return { coords, approximate: true };
        } catch {
          throw gpsError;
        }
      }
      throw gpsError;
    }
  }

  function hydrateSavedLocationGuess() {
    const locationInput = document.querySelector(selectors.locationInput);
    const saved = OpenScout.storage.getLocationGuess();

    if (!locationInput || !saved) {
      return;
    }

    state.locationGuess = saved;
    locationInput.value = saved.label;
    locationInput.placeholder = "Location";
  }

  async function refreshLocationIfAlreadyGranted() {
    if (!navigator.permissions?.query) {
      return;
    }

    try {
      const saved = OpenScout.storage.getLocationGuess();
      const apiKey = OpenScout.storage.getApiKey() || document.querySelector(selectors.apiKey).value.trim();
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "granted" && (!saved || apiKey)) {
        guessLocation({ showErrors: false });
      }
    } catch {
      // Some browsers expose geolocation but not Permissions API details.
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
      const apiKey = OpenScout.storage.getApiKey() || document.querySelector(selectors.apiKey).value.trim();
      const currentRequest = ++requestId;

      if (!apiKey) {
        renderLocationMessage("Save your API key to enable location suggestions.");
        return;
      }

      try {
        sessionToken = sessionToken || null;
        const suggestions = await OpenScout.googlePlaces.getLocationSuggestions({
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
    document.querySelector(selectors.exportCsv).disabled = state.leads.length === 0;
    updateLeadTally();
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

  const SCAN_ICON =
    '<svg class="btn-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>';
  const SCAN_SPINNER =
    '<svg class="btn-icon btn-spinner" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>';

  function setLoading(isLoading) {
    const button = document.querySelector(".scan-button");

    if (!button) {
      return;
    }

    button.disabled = isLoading;
    button.innerHTML = isLoading ? SCAN_SPINNER + " Scanning" : SCAN_ICON + " Scan";
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

    let liveNote = "";

    function paint(active) {
      steps.forEach((li, index) => {
        li.classList.toggle("is-done", index < active);
        li.classList.toggle("is-active", index === active);
      });
      // Real progress notes win over the ambient stage label when present.
      stageEl.textContent = liveNote || SCAN_STAGES[Math.min(active, SCAN_STAGES.length - 1)];
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
      note(text) {
        liveNote = text || "";
        if (liveNote) {
          stageEl.textContent = liveNote;
        }
      },
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
