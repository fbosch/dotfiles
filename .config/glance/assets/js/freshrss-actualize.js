(function () {
  var ENDPOINT =
    "https://freshrss.corvus-corax.synology.me/i/?c=feed&a=actualize&ajax=1&maxFeeds=30";
  var INTERVAL_MS = 15 * 60 * 1000;
  var LOCK_TTL_MS = 30 * 1000;
  var LAST_RUN_KEY = "glance.freshrss.actualize.lastRun";
  var LOCK_KEY = "glance.freshrss.actualize.lock";

  function now() {
    return Date.now();
  }

  function readNumber(key) {
    try {
      return Number(localStorage.getItem(key) || "0");
    } catch (_error) {
      return 0;
    }
  }

  function writeNumber(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_error) {
      // Ignore localStorage errors.
    }
  }

  function clearLock(lockUntil) {
    try {
      if (readNumber(LOCK_KEY) === lockUntil) {
        localStorage.removeItem(LOCK_KEY);
      }
    } catch (_error) {
      // Ignore localStorage errors.
    }
  }

  function shouldRun(ts) {
    return ts - readNumber(LAST_RUN_KEY) >= INTERVAL_MS;
  }

  function acquireLock(ts) {
    var existingLockUntil = readNumber(LOCK_KEY);
    if (existingLockUntil > ts) {
      return 0;
    }

    var lockUntil = ts + LOCK_TTL_MS;
    writeNumber(LOCK_KEY, lockUntil);
    return readNumber(LOCK_KEY) === lockUntil ? lockUntil : 0;
  }

  function triggerActualize() {
    var ts = now();
    if (!shouldRun(ts)) {
      return;
    }

    var lockUntil = acquireLock(ts);
    if (!lockUntil) {
      return;
    }

    writeNumber(LAST_RUN_KEY, ts);

    var img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = function () {
      clearLock(lockUntil);
    };
    img.onerror = function () {
      clearLock(lockUntil);
    };
    img.src = ENDPOINT + "&_=" + ts;
  }

  window.addEventListener("focus", triggerActualize);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      triggerActualize();
    }
  });

  if (document.readyState === "complete") {
    triggerActualize();
  } else {
    window.addEventListener("load", triggerActualize);
  }
})();
