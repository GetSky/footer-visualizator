import { FIELD_COLS, FIELD_ROWS } from "../constants.js";
import { coordToPercent } from "../field/geometry.js";

export function createFieldLayout(elements) {
  function createFieldLabels() {
    Array.from(elements.field.querySelectorAll(".cell-label")).forEach((node) => node.remove());

    for (let row = 1; row <= FIELD_ROWS; row++) {
      const label = document.createElement("div");
      label.className = "cell-label";
      const pos = coordToPercent(row, 1);
      label.textContent = String(row);
      label.style.left = `${pos.x}%`;
      label.style.bottom = "10px";
      label.style.transform = "translateX(-50%)";
      elements.field.appendChild(label);
    }

    for (let col = 1; col <= FIELD_COLS; col++) {
      const label = document.createElement("div");
      label.className = "cell-label";
      const pos = coordToPercent(1, col);
      label.textContent = String(col);
      label.style.left = "12px";
      label.style.top = `${pos.y}%`;
      label.style.transform = "translateY(-50%)";
      elements.field.appendChild(label);
    }
  }

  function resizeField() {
    if (!elements.fieldPanel || !elements.field) {
      return;
    }

    const panelRect = elements.fieldPanel.getBoundingClientRect();
    const apronRect = elements.fieldApron ? elements.fieldApron.getBoundingClientRect() : null;
    const apronStyle = elements.fieldApron ? getComputedStyle(elements.fieldApron) : null;
    const fieldStyle = getComputedStyle(elements.field);
    const apronPaddingX = apronStyle
      ? parseFloat(apronStyle.paddingLeft) + parseFloat(apronStyle.paddingRight)
      : 0;
    const fieldBorderX = parseFloat(fieldStyle.borderLeftWidth) + parseFloat(fieldStyle.borderRightWidth);
    const fieldBorderY = parseFloat(fieldStyle.borderTopWidth) + parseFloat(fieldStyle.borderBottomWidth);
    const availableOuterWidth = apronRect && apronRect.width
      ? apronRect.width
      : panelRect.width;
    const availableWidth = Math.max(260, availableOuterWidth - apronPaddingX);
    const nextContentWidth = Math.max(FIELD_ROWS * 18, Math.floor((availableWidth - fieldBorderX) / FIELD_ROWS) * FIELD_ROWS);
    const nextWidth = nextContentWidth + fieldBorderX;
    const nextContentHeight = nextContentWidth * (FIELD_COLS / (FIELD_ROWS / 2));
    const nextHeight = nextContentHeight + fieldBorderY;

    elements.field.style.width = `${nextWidth}px`;
    elements.field.style.height = `${nextHeight}px`;
  }

  function refreshFieldLayout() {
    resizeField();
    createFieldLabels();
  }

  function scheduleFieldLayoutRefresh() {
    requestAnimationFrame(() => {
      refreshFieldLayout();
      requestAnimationFrame(() => {
        refreshFieldLayout();
      });
    });
  }

  return {
    createFieldLabels,
    resizeField,
    refreshFieldLayout,
    scheduleFieldLayoutRefresh
  };
}
