(async function () {
  // Only run if the mullvad widget exists
  const widget = document.querySelector("[data-mullvad-check]");

  if (!widget) return;

  try {
    const response = await fetch("https://am.i.mullvad.net/json");
    const data = await response.json();

    const contentEl = widget.querySelector(".widget-content");
    if (!contentEl) return;

    const connected = data.mullvad_exit_ip;
    const statusClass = connected ? "color-positive" : "color-negative";
    const statusText = connected ? "Connected" : "Not connected";
    const location = data.city + ", " + data.country;

    contentEl.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <div class="${statusClass} size-h4">${statusText}</div>
          <div class="color-subdue margin-top-5">${location}</div>
        </div>
        <div>
          <span class="${statusClass}" style="font-size: 2rem;">●</span>
        </div>
      </div>
    `;
  } catch (error) {
    const contentEl = widget.querySelector(".widget-content");
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="flex items-center justify-between">
          <div>
            <div class="color-negative size-h4">Error</div>
          </div>
        </div>
      `;
    }
    console.error("Mullvad check error:", error);
  }
})();
