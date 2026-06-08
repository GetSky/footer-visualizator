export function createProgressController(elements) {
  let progressSteps = [];

  function renderProgressSteps() {
    elements.progressStepsNode.innerHTML = "";
    progressSteps.forEach((step) => {
      const item = document.createElement("div");
      item.className = `progress-step ${step.state}`;

      const textWrap = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = step.title;
      const description = document.createElement("small");
      description.textContent = step.description;

      textWrap.append(title, description);
      item.append(textWrap);
      elements.progressStepsNode.append(item);
    });
  }

  function createProgressFlow(stepDefinitions) {
    progressSteps = stepDefinitions.map((step) => ({
      key: step.key,
      title: step.title,
      description: step.description,
      state: "pending"
    }));

    elements.progressNode.classList.add("visible");
    elements.progressDetailNode.textContent = "Подготавливаю загрузку...";
    elements.progressFillNode.style.width = "0%";
    renderProgressSteps();
  }

  function updateProgress(stepKey, detail, status) {
    const currentIndex = progressSteps.findIndex((step) => step.key === stepKey);
    if (currentIndex === -1) {
      if (detail) {
        elements.progressDetailNode.textContent = detail;
      }
      return;
    }

    progressSteps = progressSteps.map((step, index) => {
      if (step.state === "error" && index !== currentIndex) {
        return step;
      }
      if (index < currentIndex && step.state !== "error") {
        return { ...step, state: "done" };
      }
      if (index === currentIndex) {
        return { ...step, state: status || "active" };
      }
      return { ...step, state: "pending" };
    });

    const completedSteps = progressSteps.filter((step) => step.state === "done").length;
    const activeStep = progressSteps[currentIndex];
    const progressValue = ((completedSteps + (activeStep && activeStep.state === "active" ? 0.5 : 1)) / Math.max(progressSteps.length, 1)) * 100;

    elements.progressDetailNode.textContent = detail || "";
    elements.progressFillNode.style.width = `${Math.max(4, Math.min(progressValue, 100))}%`;
    renderProgressSteps();
  }

  function completeProgress(detail) {
    progressSteps = progressSteps.map((step) => ({ ...step, state: "done" }));
    elements.progressDetailNode.textContent = detail;
    elements.progressFillNode.style.width = "100%";
    renderProgressSteps();
  }

  function failProgress(stepKey, detail) {
    updateProgress(stepKey, detail, "error");
  }

  return {
    createProgressFlow,
    updateProgress,
    completeProgress,
    failProgress
  };
}
