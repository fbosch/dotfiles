(async function () {
  // Only run if the mullvad widget exists
  const widget = document.querySelector("[data-mullvad-check]");

  if (!widget) return;

  try {
    const response = await fetch("https://am.i.mullvad.net/json");
    const data = await response.json();

    const statusEl = document.getElementById("mullvad-status");
    const locationEl = document.getElementById("mullvad-location");
    const dotEl = document.getElementById("mullvad-dot");

    if (!statusEl || !locationEl || !dotEl) return;

    const connected = data.mullvad_exit_ip;

    statusEl.textContent = connected ? "Connected" : "Not connected";
    statusEl.className =
      (connected ? "color-positive" : "color-negative") + " size-h4";

    locationEl.textContent = data.city + ", " + data.country;
    locationEl.className = "color-subdue margin-top-5";

    dotEl.className = connected ? "color-positive" : "color-negative";
  } catch (error) {
    const statusEl = document.getElementById("mullvad-status");
    if (statusEl) {
      statusEl.textContent = "Error";
      statusEl.className = "color-negative size-h4";
    }
    console.error("Mullvad check error:", error);
  }
})();
