(function () {
  var ENDPOINT =
    "https://freshrss.corvus-corax.synology.me/i/?c=feed&a=actualize&ajax=1&maxFeeds=30";
  var INTERVAL_MS = 15 * 60 * 1000;
  var STORAGE_KEY = "glance.freshrss.actualize.lastRun";

  function getLastRun() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY) || "0");
    } catch (_error) {
      return 0;
    }
  }

  function setLastRun(ts) {
    try {
      localStorage.setItem(STORAGE_KEY, String(ts));
    } catch (_error) {
      // Ignore localStorage errors.
    }
  }

  function shouldRun(now) {
    return now - getLastRun() >= INTERVAL_MS;
  }

  function pingFreshRSS() {
    var now = Date.now();
    if (!shouldRun(now)) {
      return;
    }

    setLastRun(now);

    var img = new Image();
    img.referrerPolicy = "no-referrer";
    img.src = ENDPOINT + "&_=" + now;
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      pingFreshRSS();
    }
  });

  window.addEventListener("focus", pingFreshRSS);
  pingFreshRSS();
})();
