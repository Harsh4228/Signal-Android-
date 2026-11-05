// Download page: fills in the newest Windows installer and Android APK from the server's /updates/ folder
// (the release script puts them there) and puts the app for this device first.
(function () {
  const $ = (id) => document.getElementById(id);
  const size = (n) => (n > 0 ? `${(n / 1024 / 1024).toFixed(0)} MB` : '');
  const day = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  };
  const show = (section, version, href, bytes, date) => {
    const v = section.querySelector('[data-version]');
    const a = section.querySelector('[data-link]');
    if (!version) {
      v.textContent = 'Not available yet';
      a.classList.add('off');
      a.removeAttribute('href');
      return;
    }
    v.textContent = ['Version ' + version, size(bytes), day(date)].filter(Boolean).join(' · ');
    a.href = href;
    a.setAttribute('download', '');
  };

  // Windows: the auto-update file (latest.yml) names the installer.
  fetch('/updates/latest.yml', { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : ''))
    .then((y) => {
      const get = (k) => (y.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1]?.trim().replace(/^['"]|['"]$/g, '');
      const file = get('path');
      const bytes = Number((y.match(/^\s+size:\s*(\d+)/m) || [])[1] || 0);
      show($('windows'), file && get('version'), file && '/updates/' + encodeURIComponent(file), bytes, get('releaseDate'));
    })
    .catch(() => show($('windows')));

  // Android: android/latest.json, written with each release.
  fetch('/updates/android/latest.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => show($('android'), j && j.version, j && '/updates/android/' + encodeURIComponent(j.file), j && j.size, j && j.date))
    .catch(() => show($('android')));

  // The real App Store link once the server has it (updates/links.json: { "appStore": "https://apps.apple.com/..." }).
  fetch('/updates/links.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && /^https:\/\/apps\.apple\.com\//.test(j.appStore || '')) document.querySelector('[data-appstore]').href = j.appStore;
    })
    .catch(() => {});

  // This device's app first.
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : /Windows/i.test(ua) ? 'windows' : '';
  const mine = os && document.querySelector('[data-os="' + os + '"]');
  if (mine) {
    mine.classList.add('mine');
    const tag = document.createElement('span');
    tag.className = 'mine-tag';
    tag.textContent = 'For this device';
    mine.querySelector('.app-head > div').appendChild(tag);
  }
})();
