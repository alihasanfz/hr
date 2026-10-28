(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});

  var side = $('#side'); var menuBtn = $('#menuBtn');
  if (menuBtn && side) {
    menuBtn.addEventListener('click', function () {
      var open = side.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    side.addEventListener('click', function (e) { if (e.target.tagName === 'A') side.classList.remove('open'); });
  }

  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var el = $(b.getAttribute('data-copy'));
      if (el && navigator.clipboard) navigator.clipboard.writeText(el.textContent.trim()).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); });
    });
  });

  $$('[data-test]').forEach(function (b) {
    b.addEventListener('click', function () {
      var out = $('#test-' + b.getAttribute('data-test'));
      out.textContent = 'Testing...';
      fetch('/devices/' + b.getAttribute('data-test') + '/test', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (j) { out.textContent = (j.ok ? 'Connected. ' : 'Not reachable. ') + j.message; })
        .catch(function () { out.textContent = 'The test could not run.'; });
    });
  });

  // Dashboard: live numbers and 7-day chart
  var live = $('[data-live-root]');
  if (live) {
    var pct = function (n, total) { return total ? Math.round((n / total) * 100) : 0; };
    var render = function (s) {
      var t = s.totals;
      $$('[data-k]').forEach(function (el) { if (t[el.getAttribute('data-k')] != null) el.textContent = t[el.getAttribute('data-k')]; });
      $('#barOn').style.width = pct(t.onTime, t.expected) + '%';
      $('#barLate').style.width = pct(t.late, t.expected) + '%';
      $('#barNot').style.width = pct(t.notIn, t.expected) + '%';
      $('#updated').textContent = s.time;
      var att = s.late.map(function (p) { return '<li><a href="/attendance/employee/' + p.id + '">' + esc(p.name) + '</a><span class="muted">' + esc(p.dept) + '</span><span class="st st-late">In ' + esc(p.in) + ' · ' + p.late + ' min late</span></li>'; })
        .concat(s.notIn.map(function (p) { return '<li><a href="/attendance/employee/' + p.id + '">' + esc(p.name) + '</a><span class="muted">' + esc(p.dept) + '</span><span class="st st-none">Not in yet</span></li>'; }));
      $('#attention').innerHTML = att.join('') || '<li class="muted">Everyone expected today is in on time.</li>';
      $('#recent').innerHTML = s.recent.map(function (r) { return '<li><span class="mono">' + esc(r.time) + '</span><span>' + esc(r.name) + '</span><span class="muted">' + esc(r.device) + '</span></li>'; }).join('') || '<li class="muted">No punches yet.</li>';
      $('#depts tbody').innerHTML = s.departments.map(function (d) { return '<tr><td>' + esc(d.name) + '</td><td class="num">' + d.present + '</td><td class="num">' + d.late + '</td><td class="num">' + d.total + '</td></tr>'; }).join('');
    };
    setInterval(function () {
      if (document.hidden) return;
      fetch('/api/dashboard/live').then(function (r) { return r.ok ? r.json() : null; }).then(function (s) { if (s) render(s); }).catch(function () {});
    }, 20000);

    window.addEventListener('load', function () {
      var cv = $('#trend');
      if (!cv || !window.Chart) return;
      fetch('/api/dashboard/trend').then(function (r) { return r.json(); }).then(function (rows) {
        var day = function (d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }); };
        new window.Chart(cv, {
          type: 'bar',
          data: {
            labels: rows.map(function (r) { return day(r.date); }),
            datasets: [
              { label: 'On time', data: rows.map(function (r) { return r.present; }), backgroundColor: '#38c58b' },
              { label: 'Late', data: rows.map(function (r) { return r.late; }), backgroundColor: '#f5a524' },
              { label: 'Absent', data: rows.map(function (r) { return r.absent; }), backgroundColor: '#d9534f' }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }
        });
      });
    });
  }

  // Phone alerts (Web Push) for Admin and HR
  var pushBtn = $('#pushBtn');
  if (pushBtn) {
    var note = $('#pushNote');
    var b64 = function (s) { var p = '='.repeat((4 - s.length % 4) % 4); var r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, function (c) { return c.charCodeAt(0); }); };
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      note.textContent = 'This browser does not support phone alerts. On iPhone, add the app to your Home Screen first.';
    } else {
      fetch('/api/push/key').then(function (r) { return r.json(); }).then(function (j) {
        if (!j.key) { note.textContent = 'Phone alerts are not set up on the server yet. Add VAPID keys (npm run vapid) to enable them.'; return; }
        navigator.serviceWorker.ready.then(function (reg) {
          reg.pushManager.getSubscription().then(function (sub) {
            if (sub && Notification.permission === 'granted') { note.textContent = 'Phone alerts are on for this device.'; return; }
            pushBtn.hidden = false;
            pushBtn.addEventListener('click', function () {
              Notification.requestPermission().then(function (perm) {
                if (perm !== 'granted') { note.textContent = 'Notifications are blocked. Allow them in your browser settings, then try again.'; return; }
                reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(j.key) }).then(function (s) {
                  return fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
                }).then(function () { pushBtn.hidden = true; note.textContent = 'Phone alerts are on for this device.'; })
                  .catch(function () { note.textContent = 'Could not turn on phone alerts. Try again.'; });
              });
            });
          });
        });
      });
    }
  }
})();
