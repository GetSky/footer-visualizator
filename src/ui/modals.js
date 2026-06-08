export function createModalController(elements, options) {
  let episodeModalPreviouslyFocused = null;
  let eventListModalPreviouslyFocused = null;

  function openEpisodeModal() {
    episodeModalPreviouslyFocused = document.activeElement;
    elements.episodeModalBackdrop.classList.add("open");
    elements.episodeModalBackdrop.setAttribute("aria-hidden", "false");
    elements.episodeModalClose.focus();
  }

  function closeEpisodeModal() {
    if (!elements.episodeModalBackdrop.classList.contains("open")) {
      return;
    }

    elements.episodeModalBackdrop.classList.remove("open");
    elements.episodeModalBackdrop.setAttribute("aria-hidden", "true");

    if (episodeModalPreviouslyFocused && typeof episodeModalPreviouslyFocused.focus === "function") {
      episodeModalPreviouslyFocused.focus();
    }
    episodeModalPreviouslyFocused = null;
  }

  function openEventListModal() {
    if (!options.hasEvents()) {
      return;
    }

    eventListModalPreviouslyFocused = document.activeElement;
    elements.eventListModalBackdrop.classList.add("open");
    elements.eventListModalBackdrop.setAttribute("aria-hidden", "false");
    elements.eventListModalClose.focus();
  }

  function closeEventListModal() {
    if (!elements.eventListModalBackdrop.classList.contains("open")) {
      return;
    }

    elements.eventListModalBackdrop.classList.remove("open");
    elements.eventListModalBackdrop.setAttribute("aria-hidden", "true");

    if (eventListModalPreviouslyFocused && typeof eventListModalPreviouslyFocused.focus === "function") {
      eventListModalPreviouslyFocused.focus();
    }
    eventListModalPreviouslyFocused = null;
  }

  return {
    openEpisodeModal,
    closeEpisodeModal,
    openEventListModal,
    closeEventListModal
  };
}
