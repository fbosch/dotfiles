(function() {
  'use strict';

  const REFRESH_INTERVAL_ACTIVE = 5000;
  const REFRESH_INTERVAL_IDLE = 30000;
  const WIDGET_SELECTOR = '[data-rd-live]';

  let currentInterval = null;

  function updateProgress(item, torrent) {
    const progress = torrent.progress || 0;
    const speed = torrent.speed || 0;
    const status = torrent.status || 'unknown';

    const progressValue = item.querySelector('.progress-value');
    if (progressValue) {
      progressValue.style.setProperty('--percent', progress);
    }

    const bottomRow = item.querySelector('.size-h6.color-subdue');
    if (bottomRow) {
      const spans = bottomRow.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = `${progress}%`;
      if (spans[1]) {
        spans[1].textContent = speed > 0 ? `${(speed / 1000000).toFixed(1)} MB/s` : '--';
      }
    }

    const statusEl = item.querySelector('.rd-state');
    if (statusEl) {
      let statusText = 'Unknown';
      let statusClass = 'pending';

      if (status === 'downloading') { statusText = 'Downloading'; statusClass = 'active'; }
      else if (status === 'queued') { statusText = 'Queued'; statusClass = 'pending'; }
      else if (status === 'magnet_conversion') { statusText = 'Magnet'; statusClass = 'magnet'; }
      else if (status === 'waiting_files_selection') { statusText = 'Selecting'; statusClass = 'waiting'; }
      else if (status === 'compressing') { statusText = 'Compressing'; statusClass = 'compressing'; }
      else if (status === 'uploading') { statusText = 'Uploading'; statusClass = 'uploading'; }
      else if (status === 'downloaded') { statusText = 'Done'; statusClass = 'done'; }
      else if (status === 'error' || status === 'magnet_error') { statusText = 'Error'; statusClass = 'error'; }
      else if (status === 'dead') { statusText = 'Dead'; statusClass = 'dead'; }

      statusEl.className = `rd-state rd-state-${statusClass} shrink-0`;
      const statusTextEl = statusEl.querySelector('span:last-child');
      if (statusTextEl) statusTextEl.textContent = statusText;
    }
  }

  function refreshWidget() {
    const widget = document.querySelector(WIDGET_SELECTOR);
    if (!widget) return;

    const apiKey = widget.dataset.rdApiKey;
    if (!apiKey) return;

    fetch('https://api.real-debrid.com/rest/1.0/torrents?filter=active&limit=10', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(torrents => {
      const items = widget.querySelectorAll('.rd-item');
      items.forEach((item, index) => {
        if (torrents[index]) updateProgress(item, torrents[index]);
      });

      const activeCount = widget.querySelector('.rd-stat-value');
      if (activeCount) activeCount.textContent = torrents.length;

      const hasActive = torrents.length > 0;
      if (hasActive !== (widget.dataset.rdHasActive === 'true')) {
        widget.dataset.rdHasActive = hasActive;
        startRefreshLoop();
      }
    })
    .catch(err => {
      console.error('RD live update failed:', err);
    });
  }

  function startRefreshLoop() {
    const widget = document.querySelector(WIDGET_SELECTOR);
    if (!widget) return;

    const hasActive = widget.dataset.rdHasActive === 'true';
    const interval = hasActive ? REFRESH_INTERVAL_ACTIVE : REFRESH_INTERVAL_IDLE;

    if (currentInterval) clearInterval(currentInterval);
    currentInterval = setInterval(refreshWidget, interval);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRefreshLoop);
  } else {
    startRefreshLoop();
  }
})();
