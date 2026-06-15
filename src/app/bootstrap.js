import { getMatchUrlFromQuery } from "./query.js";

function isLocalResourceLaunch(location = window.location) {
  return location.protocol === "file:" || location.protocol === "res:";
}

function syncLocalSourceVisibility(elements) {
  elements.localSourceGrid.classList.toggle("hidden", !isLocalResourceLaunch());
}

function isTimelineShortcutTarget(target) {
  if (!target) {
    return false;
  }
  const tagName = target.tagName ? target.tagName.toLowerCase() : "";
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function wireAppEvents(options) {
  const {
    closeEpisodeModal,
    closeEventListModal,
    elements,
    openEpisodeModal,
    openEventListModal,
    parseMatchPage,
    schedulePlayback,
    setCurrentIndex,
    state,
    stopPlayback
  } = options;

  function moveTimelineBy(delta) {
    if (!state.snapshots.length) {
      return false;
    }
    const nextIndex = state.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= state.snapshots.length) {
      return false;
    }
    stopPlayback();
    setCurrentIndex(nextIndex);
    return true;
  }

  elements.loadButton.addEventListener("click", parseMatchPage);
  elements.urlInput.addEventListener("paste", () => {
    setTimeout(() => {
      if (elements.urlInput.value.trim()) {
        parseMatchPage();
      }
    }, 0);
  });
  elements.pageFileInput.addEventListener("change", () => {
    if (elements.pageFileInput.files && elements.pageFileInput.files[0]) {
      parseMatchPage();
    }
  });
  elements.urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      parseMatchPage();
    }
  });
  elements.timelineLabel.addEventListener("click", openEventListModal);
  elements.episodeInfoButton.addEventListener("click", openEpisodeModal);
  elements.episodeModalClose.addEventListener("click", closeEpisodeModal);
  elements.episodeModalBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.episodeModalBackdrop) {
      closeEpisodeModal();
    }
  });
  elements.eventListModalClose.addEventListener("click", closeEventListModal);
  elements.eventListModalBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.eventListModalBackdrop) {
      closeEventListModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeEpisodeModal();
      closeEventListModal();
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || isTimelineShortcutTarget(event.target)) {
      return;
    }

    if (event.key === "ArrowLeft" && moveTimelineBy(-1)) {
      event.preventDefault();
    } else if (event.key === "ArrowRight" && moveTimelineBy(1)) {
      event.preventDefault();
    }
  });

  elements.playButton.addEventListener("click", () => {
    if (state.timer) {
      stopPlayback();
    } else {
      schedulePlayback();
    }
  });

  elements.prevButton.addEventListener("click", () => {
    moveTimelineBy(-1);
  });

  elements.nextButton.addEventListener("click", () => {
    moveTimelineBy(1);
  });

  elements.timelineRange.addEventListener("input", () => {
    stopPlayback();
    setCurrentIndex(Number(elements.timelineRange.value));
  });

  return {
    moveTimelineBy
  };
}

export function initializeApp(options) {
  const {
    createFieldLabels,
    elements,
    parseMatchPage,
    refreshFieldLayout,
    renderEventCard,
    resizeField,
    updateButtons
  } = options;

  syncLocalSourceVisibility(elements);

  const queryMatchUrl = getMatchUrlFromQuery(window.location.search);
  if (queryMatchUrl) {
    elements.urlInput.value = queryMatchUrl;
    parseMatchPage();
  }

  createFieldLabels();
  resizeField();
  renderEventCard(null);
  updateButtons();
  window.addEventListener("resize", () => {
    refreshFieldLayout();
  });
  if ("ResizeObserver" in window) {
    const fieldResizeObserver = new ResizeObserver(() => {
      refreshFieldLayout();
    });
    fieldResizeObserver.observe(elements.fieldPanel);
    return { fieldResizeObserver };
  }

  return { fieldResizeObserver: null };
}
