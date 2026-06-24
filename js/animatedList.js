(function () {
  const DEFAULT_ITEMS = [
    "Roofers without websites",
    "Barbershops with only social links",
    "Plumbers missing a real site",
    "Dentists with stale directory listings",
    "Auto repair shops with no website",
    "Landscapers relying on Google only",
    "Nail salons without booking pages",
    "Local restaurants missing menus",
    "Electricians without service pages",
    "Med spas with weak web presence",
  ];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function createAnimatedList(mount, options = {}) {
    if (!mount) {
      return null;
    }

    const config = {
      items: options.items || readItemsFromMarkup(mount) || DEFAULT_ITEMS,
      showGradients: options.showGradients !== false,
      enableArrowNavigation: options.enableArrowNavigation !== false,
      className: options.className || "",
      itemClassName: options.itemClassName || "",
      displayScrollbar: options.displayScrollbar !== false,
      initialSelectedIndex: Number.isFinite(options.initialSelectedIndex) ? options.initialSelectedIndex : -1,
      onItemSelect: typeof options.onItemSelect === "function" ? options.onItemSelect : null,
      renderItem: typeof options.renderItem === "function" ? options.renderItem : null,
    };

    let selectedIndex = config.initialSelectedIndex;
    let keyboardNav = false;

    mount.classList.add("animated-list-container");
    if (config.className) {
      mount.classList.add(...config.className.split(" ").filter(Boolean));
    }
    mount.innerHTML = "";

    const list = document.createElement("div");
    list.className = "animated-list";
    list.role = "listbox";
    list.tabIndex = 0;
    list.setAttribute("aria-label", mount.getAttribute("aria-label") || "Animated list");

    if (!config.displayScrollbar) {
      list.classList.add("no-scrollbar");
    }

    const topGradient = document.createElement("div");
    topGradient.className = "animated-list-gradient top-gradient";
    topGradient.style.opacity = "0";

    const bottomGradient = document.createElement("div");
    bottomGradient.className = "animated-list-gradient bottom-gradient";
    bottomGradient.style.opacity = "1";

    const itemNodes = config.items.map((item, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "animated-list-item-wrap";
      wrapper.dataset.index = String(index);
      wrapper.style.transitionDelay = reduceMotion.matches ? "0ms" : `${Math.min(index * 35 + 100, 260)}ms`;

      const row = document.createElement(config.renderItem ? "div" : "button");
      row.className = ["animated-list-item", config.itemClassName].filter(Boolean).join(" ");
      if (!config.renderItem) {
        row.type = "button";
      }
      row.role = "option";
      row.tabIndex = -1;

      if (config.renderItem) {
        const rendered = config.renderItem(item, index);

        if (rendered instanceof Node) {
          row.appendChild(rendered);
        } else {
          row.textContent = String(rendered == null ? "" : rendered);
        }
      } else {
        row.innerHTML = '<span class="animated-list-item-text"></span>';
        row.querySelector(".animated-list-item-text").textContent = item.label || item.text || String(item);

        if (item.meta) {
          const meta = document.createElement("span");
          meta.className = "animated-list-item-meta";
          meta.textContent = item.meta;
          row.appendChild(meta);
        }
      }

      row.addEventListener("mouseenter", () => setSelectedIndex(index));
      row.addEventListener("click", (event) => {
        if (config.renderItem && event.target.closest("a, button, input, select, textarea")) {
          setSelectedIndex(index);
          return;
        }

        selectItem(item, index);
      });

      wrapper.appendChild(row);
      list.appendChild(wrapper);
      return wrapper;
    });

    mount.appendChild(list);

    if (config.showGradients) {
      mount.append(topGradient, bottomGradient);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        });
      },
      {
        root: list,
        rootMargin: "120px 0px",
        threshold: 0.12,
      }
    );

    itemNodes.forEach((node) => observer.observe(node));

    list.addEventListener("scroll", handleListScroll);
    list.addEventListener("keydown", handleKeyDown);
    updateSelectedState();
    refreshVisibility();
    updateGradients();

    function setSelectedIndex(index) {
      selectedIndex = Math.min(config.items.length - 1, Math.max(0, index));
      updateSelectedState();
    }

    function selectItem(item, index) {
      setSelectedIndex(index);

      if (config.onItemSelect) {
        config.onItemSelect(item, index);
      }

      if (item.href) {
        window.location.href = item.href;
      }
    }

    function handleKeyDown(event) {
      if (!config.enableArrowNavigation) {
        return;
      }

      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        keyboardNav = true;
        setSelectedIndex(selectedIndex < 0 ? 0 : selectedIndex + 1);
        scrollSelectedIntoView();
      } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        keyboardNav = true;
        setSelectedIndex(selectedIndex < 0 ? 0 : selectedIndex - 1);
        scrollSelectedIntoView();
      } else if (event.key === "Enter" && selectedIndex >= 0) {
        event.preventDefault();
        selectItem(config.items[selectedIndex], selectedIndex);
      }
    }

    function scrollSelectedIntoView() {
      if (!keyboardNav) {
        return;
      }

      const selectedItem = list.querySelector(`[data-index="${selectedIndex}"]`);

      if (selectedItem) {
        const selectedOption = selectedItem.querySelector(".animated-list-item");
        const extraMargin = 50;
        const itemTop = selectedItem.offsetTop;
        const itemBottom = itemTop + selectedItem.offsetHeight;
        const containerScrollTop = list.scrollTop;
        const containerHeight = list.clientHeight;

        let targetTop = null;

        if (itemTop < containerScrollTop + extraMargin) {
          targetTop = itemTop - extraMargin;
        } else if (itemBottom > containerScrollTop + containerHeight - extraMargin) {
          targetTop = itemBottom - containerHeight + extraMargin;
        }

        if (targetTop !== null) {
          if (selectedOption) {
            selectedOption.focus({ preventScroll: false });
          }
          list.scrollTo({ top: targetTop, behavior: reduceMotion.matches ? "auto" : "smooth" });
          selectedItem.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: reduceMotion.matches ? "auto" : "smooth",
          });
          requestAnimationFrame(() => {
            if (Math.abs(list.scrollTop - targetTop) > 8) {
              list.scrollTop = targetTop;
              selectedItem.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
            refreshVisibility();
            updateGradients();
          });
        }
      }

      keyboardNav = false;
    }

    function updateSelectedState() {
      itemNodes.forEach((node, index) => {
        const row = node.querySelector(".animated-list-item");
        const isSelected = index === selectedIndex;
        row.classList.toggle("selected", isSelected);
        row.setAttribute("aria-selected", String(isSelected));
      });
    }

    function updateGradients() {
      if (!config.showGradients) {
        return;
      }

      const topOpacity = Math.min(list.scrollTop / 50, 1);
      const bottomDistance = list.scrollHeight - (list.scrollTop + list.clientHeight);
      const bottomOpacity = list.scrollHeight <= list.clientHeight ? 0 : Math.min(bottomDistance / 50, 1);

      topGradient.style.opacity = String(topOpacity);
      bottomGradient.style.opacity = String(bottomOpacity);
    }

    function refreshVisibility() {
      const listRect = list.getBoundingClientRect();
      const visibilityMargin = 120;

      itemNodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        const nearViewport = rect.bottom >= listRect.top - visibilityMargin && rect.top <= listRect.bottom + visibilityMargin;

        if (nearViewport) {
          node.classList.add("is-visible");
        }
      });
    }

    function handleListScroll() {
      refreshVisibility();
      updateGradients();
    }

    return {
      destroy() {
        observer.disconnect();
        list.removeEventListener("scroll", handleListScroll);
        list.removeEventListener("keydown", handleKeyDown);
      },
      getSelectedIndex() {
        return selectedIndex;
      },
    };
  }

  function readItemsFromMarkup(mount) {
    const nodes = Array.from(mount.querySelectorAll("[data-animated-list-item]"));

    if (!nodes.length) {
      return null;
    }

    return nodes.map((node) => ({
      label: node.textContent.trim(),
      meta: node.dataset.meta || "",
      href: node.getAttribute("href") || node.dataset.href || "",
    }));
  }

  function parseBoolean(value, fallback) {
    if (value == null) {
      return fallback;
    }

    return value !== "false";
  }

  function initDeclarativeLists() {
    document.querySelectorAll("[data-animated-list]").forEach((mount) => {
      createAnimatedList(mount, {
        showGradients: parseBoolean(mount.dataset.showGradients, true),
        enableArrowNavigation: parseBoolean(mount.dataset.enableArrowNavigation, true),
        displayScrollbar: parseBoolean(mount.dataset.displayScrollbar, true),
        initialSelectedIndex: Number(mount.dataset.initialSelectedIndex || -1),
      });
      mount.dataset.ready = "true";
    });
  }

  window.OpenScout = window.OpenScout || {};
  window.OpenScout.AnimatedList = {
    create: createAnimatedList,
  };

  document.addEventListener("DOMContentLoaded", initDeclarativeLists);
})();
