/* OCCPL Logistics website: menu, tracking (OCCPL courier platform public API), scan to track, calculators. */
(function () {
  'use strict';
  var cfg = window.OCCPL_CONFIG || {};
  var API = (cfg.apiBase || '/api/v1').replace(/\/$/, '');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clean(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
  // Several numbers may be typed at once, separated by commas (or semicolons / new lines).
  var MAX_TRACK = 25;
  function numbers(v) {
    var seen = {};
    return String(v || '').split(/[,;\n]+/).map(clean).filter(function (n) { return n && !seen[n] && (seen[n] = true); });
  }

  // ---- menu
  var hd = $('#hd'), menu = $('.menu');
  if (menu) menu.addEventListener('click', function () {
    var open = hd.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? '✕' : '☰';
  });

  // ---- years in business, counted from the year the company started
  $$('[data-since]').forEach(function (e) { var y = new Date().getFullYear() - +e.getAttribute('data-since'); if (y > 0) e.textContent = y + '+'; });

  // ---- WhatsApp: phones open the app from the wa.me link; computers go straight to WhatsApp Web
  var onPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  $$('a[href^="https://wa.me/"]').forEach(function (a) {
    if (onPhone) { a.removeAttribute('target'); return; }
    a.href = a.href.replace(/^https:\/\/wa\.me\/(\d+)\?/, 'https://web.whatsapp.com/send?phone=$1&');
  });

  // ---- any "track" form: go to the Track page with the number
  $$('form[data-track-form]').forEach(function (f) {
    f.querySelector('input').addEventListener('input', function () { this.setCustomValidity(''); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = f.querySelector('input'), list = numbers(input.value), n = list.join(',');
      if (!n) { input.focus(); return; }
      if (list.length > MAX_TRACK) { input.setCustomValidity('Track up to ' + MAX_TRACK + ' numbers at a time. You entered ' + list.length + '.'); input.reportValidity(); return; }
      if ($('#track-app') && f.hasAttribute('data-inline')) { history.replaceState(null, '', '?awb=' + encodeURIComponent(n)); show(list); }
      else location.href = '/track/?awb=' + encodeURIComponent(n);
    });
  });

  // ---- scan to track: the camera reads a barcode / QR and tracks its number
  var scan = $('#scan'), video = $('#scan-video'), msg = $('#scan-msg'), stream = null, stop = false;
  function detectorFactory() {
    if ('BarcodeDetector' in window) return Promise.resolve(window.BarcodeDetector);
    // Browsers without a built-in reader (e.g. iPhone Safari): a reader based on ZXing, loaded only when needed.
    return import('https://cdn.jsdelivr.net/npm/barcode-detector@2.3.1/pure/+esm').then(function (m) { return m.BarcodeDetector; });
  }
  function numberFrom(raw) {
    var v = String(raw || '').trim();
    try { var u = new URL(v); var p = u.searchParams.get('awb') || u.searchParams.get('number') || u.searchParams.get('q'); if (p) return clean(p); var seg = u.pathname.split('/').filter(Boolean).pop(); if (seg) return clean(seg); } catch (e) { /* not a link */ }
    return clean(v);
  }
  function closeScan() {
    stop = true;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (scan) scan.classList.remove('open');
  }
  function openScan() {
    if (!scan) return;
    stop = false;
    scan.classList.add('open');
    msg.textContent = 'Starting the camera…';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'This browser cannot use the camera. Type the number instead.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
      stream = s; video.srcObject = s; return video.play();
    }).then(detectorFactory).then(function (Detector) {
      var det = new Detector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'codabar', 'itf', 'data_matrix', 'pdf417'] });
      msg.textContent = 'Point the camera at the barcode or QR on your receipt or shipment label.';
      (function loop() {
        if (stop) return;
        det.detect(video).then(function (codes) {
          var hit = codes && codes[0] && numberFrom(codes[0].rawValue);
          if (hit) {
            msg.textContent = '✓ Read ' + hit + ' · opening…';
            closeScan();
            if ($('#track-app')) { history.replaceState(null, '', '?awb=' + encodeURIComponent(hit)); $$('form[data-track-form] input').forEach(function (i) { i.value = hit; }); track(hit); }
            else location.href = '/track/?awb=' + encodeURIComponent(hit);
          } else setTimeout(loop, 250);
        }).catch(function () { setTimeout(loop, 400); });
      })();
    }).catch(function (e) {
      msg.textContent = e && e.name === 'NotAllowedError'
        ? 'Camera permission was refused. Allow the camera for this site, or type the number.'
        : 'Scanning on this device is under development. Type the number instead.';
    });
  }
  $$('[data-scan]').forEach(function (b) { b.addEventListener('click', openScan); });
  $$('[data-scan-close]').forEach(function (b) { b.addEventListener('click', closeScan); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && scan && scan.classList.contains('open')) closeScan(); });

  // ---- tracking page
  var STEPS = [
    ['BOOKED', 'Booked', 'Shipment booked at the branch'],
    ['READY_FOR_MANIFEST', 'Ready for dispatch', 'Packed and added to the load sheet'],
    ['MANIFEST_CREATED', 'Manifested', 'Assigned to a vehicle'],
    ['DISPATCHED', 'In transit', 'On the way to the delivery branch'],
    ['IN_SCAN', 'Reached delivery branch', 'Received at the destination branch'],
    ['OUT_FOR_DELIVERY', 'Out for delivery', 'With our delivery partner today'],
    ['DELIVERED', 'Delivered', 'Handed over to the receiver']
  ];
  var LABEL = {}; STEPS.forEach(function (s) { LABEL[s[0]] = s[1]; });
  LABEL.RETURNED = 'Returned to sender'; LABEL.CANCELLED = 'Cancelled';
  var BADGE = { DELIVERED: 'p-green', RETURNED: 'p-amber', CANCELLED: 'p-red' };
  function fmtDate(d) { if (!d) return '—'; var x = new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmtTime(t) { if (!t) return ''; var x = new Date(t); return isNaN(x) ? '' : x.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  var TIMEOUT_MS = 15000, OLD_TIMEOUT_MS = 30000; // cover the whole request, including reading the body
  function api(path, opts) { return request(API + path, opts, TIMEOUT_MS); }
  function request(url, opts, ms) {
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, ms);
    function done() { clearTimeout(timer); }
    var p = fetch(url, Object.assign({ headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: ctl.signal }, opts || {}))
      .then(function (r) {
        return r.json().catch(function (e) { if (ctl.signal.aborted) throw e; return {}; })
          .then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      });
    p.then(done, done);
    return p;
  }
  function slow(e) { return !!e && e.name === 'AbortError'; }
  // Anything that is not working right now is shown as under development, with a way to reach us.
  var DEV_MSG = 'This feature is under development. Please call 93703 21219 or WhatsApp 97639 21219.';
  function devNote(what) {
    return '<div class="dev" role="status"><span class="pill p-amber">Under development</span><p>' + esc(what ? what + ' is under development.' : 'This feature is under development.') +
      ' Please call or WhatsApp us.</p><p class="dev-btns"><a class="btn btn--red" href="tel:+919370321219">Call 93703 21219</a>' +
      '<a class="btn btn--soft" href="https://wa.me/919763921219?text=Hello%20OCCPL%20Logistics%2C%20I%20need%20help%20with%20a%20shipment." rel="noopener">WhatsApp 97639 21219</a></p></div>';
  }
  // A message from the service about what was typed (4xx) is kept; anything else means the service is not working.
  function userMsg(r) { return r && r.status >= 400 && r.status < 500 && r.status !== 404 && r.status !== 429 && r.body && r.body.message; }
  var app = $('#track-app'), current = null;
  function track(n) {
    if (!app) return;
    current = n;
    app.innerHTML = '<div class="skel" aria-label="Loading"></div>';
    api('/track/' + encodeURIComponent(n)).then(function (r) {
      if (current !== n) return;
      if (r.status === 404) return trackOld(n);
      if (!r.ok) {
        app.innerHTML = r.status === 429 ? '<div class="err" role="alert">Too many searches. Please wait a minute and try again.</div>' : userMsg(r) ? '<div class="err" role="alert">' + esc(userMsg(r)) + '</div>' : devNote('Tracking');
        return;
      }
      render(r.body.data || r.body);
    }).catch(function (e) {
      if (current !== n) return;
      app.innerHTML = devNote('Tracking') + '<p><button class="btn btn--line" type="button" id="retry">Try again</button></p>';
      $('#retry').addEventListener('click', function () { track(n); });
    });
  }
  // Shipments booked in the old system (what the old website tracked): asked only when the courier platform has no such number.
  function trackOld(n) {
    var none = '<div class="err" role="alert">' + esc('No shipment found for ' + n + '. Check the AWB / docket number on your receipt.') + '</div>';
    if (!/^[A-Z0-9_-]{4,30}$/.test(n)) { app.innerHTML = none; return; }
    return request('/api/old-track/' + n, {}, OLD_TIMEOUT_MS).then(function (r) {
      if (current !== n) return;
      if (r.status === 404) { app.innerHTML = none; return; }
      if (!r.ok || !r.body || (!r.body.internal_status && !r.body.shipway_status)) {
        app.innerHTML = r.status === 429 ? '<div class="err" role="alert">Too many searches. Please wait a minute and try again.</div>' : devNote('Tracking');
        return;
      }
      renderOld(r.body, n);
    });
  }
  function renderOld(d, n) {
    var o = d.internal_status, s = d.shipway_status, photo = '', carrier = '<p class="hint">No shipment data available.</p>';
    function rows(list) { return '<div class="kv">' + list.map(function (x) { return '<div><small>' + x[0] + '</small><span>' + (x[1] ? esc(x[1]) : 'N/A') + '</span></div>'; }).join('') + '</div>'; }
    var order = o ? rows([['Awb No', o.awb_no], ['Consignor', o.consignor], ['Consignee', o.consignee], ['Consignee Address', o.consignee_address],
      ['Consignee City', o.consignee_city], ['Consignee Contact', o.consignee_contact], ['Forwarding Associate', o.forwarding_associate],
      ['Forwarding No', o.forwarding_no], ['Action', o.action], ['Booking Date', o.booking_date], ['Status Date', o.status_date],
      ['Proof', o.proof], ['Remarks', o.remarks]]) : '<p class="hint">No data available.</p>';
    if (o && /^[A-Za-z0-9+/=\s]+$/.test(o.photo_base64 || '')) photo = '<h3 style="font-size:16px;margin-top:16px">Proof of delivery</h3><img src="data:image/jpeg;base64,' + o.photo_base64.replace(/\s+/g, '') + '" alt="Proof of delivery" style="margin-top:10px;border-radius:12px">';
    if (s && !s.error) {
      var x = s.extra_fields || {}, list = [['AWB No', s.awbno], ['Order ID', s.order_id], ['Carrier', s.carrier], ['Pickup Date', s.pickup_date], ['Current Status', s.current_status]];
      if (s.extra_fields) list.push(['Recipient', x.reciever], ['Last Center Name', x.lastCenterName], ['Last Center Phone', x.lastCenterph], ['Expected Delivery Date', x.expected_delivery_date]);
      carrier = rows(list) + (/^https?:\/\//i.test(s.tracking_url || '') ? '<p style="margin:14px 0 0"><a class="btn btn--soft" href="' + esc(s.tracking_url) + '" target="_blank" rel="noopener noreferrer">Track with the carrier</a></p>' : '');
      if (Array.isArray(s.scan) && s.scan.length) carrier += '<h3 style="font-size:16px;margin-top:20px">Scan events</h3>' + rows(s.scan.map(function (e) { return [esc(fmtTime(e.time) || e.time), (e.status_detail || '') + (e.location ? ' at ' + e.location : '')]; }));
    }
    app.innerHTML = backLink() + '<div class="tgrid old"><div class="panel"><div class="awb"><small>AWB number</small><div>' + esc((o && o.awb_no) || n) + '</div></div>' +
      (o && o.action ? '<p style="margin:12px 0 0"><span class="pill p-info" style="white-space:normal;overflow-wrap:anywhere">' + esc(o.action) + '</span></p>' : '') +
      '<h2 style="font-size:18px;margin-top:22px">Order details</h2>' + order + photo + '</div>' +
      '<div style="display:grid;gap:24px"><div class="panel"><h2 style="font-size:18px">Shipment details</h2>' + carrier + '</div>' +
      '<div class="panel help"><h2 style="font-size:18px">Need help?</h2><a href="tel:+919370321219">Call customer care <span style="color:var(--primary-strong)">93703 21219</span></a><a href="mailto:info@occpllogistics.com">Email us <span>info@occpllogistics.com</span></a></div></div></div>';
  }
  function render(t) {
    var back = backLink();
    var status = t.status, idx = -1;
    STEPS.forEach(function (s, i) { if (s[0] === status) idx = i; });
    var when = {}; (t.timeline || []).forEach(function (e) { when[e.status] = e.changedAt; });
    var bad = status === 'CANCELLED' || status === 'RETURNED';
    var pct = status === 'DELIVERED' ? 100 : idx < 0 ? 8 : Math.round((idx + 0.5) / STEPS.length * 100);
    var steps = STEPS.map(function (s, i) {
      var done = idx >= 0 && i < idx || status === 'DELIVERED', now = i === idx && status !== 'DELIVERED';
      var cls = done ? '' : now ? 'now' : 'todo';
      return '<div class="' + (done ? '' : 'todo') + '"><span class="dot ' + cls + '">' + (done ? '✓' : now ? '●' : '') + '</span><span><b' + (cls === 'todo' ? ' style="color:var(--muted)"' : '') + '>' + s[1] + '</b><br><span>' + s[2] + '</span></span><time>' + esc(fmtTime(when[s[0]])) + '</time></div>';
    }).join('');
    if (bad) steps += '<div><span class="dot bad">!</span><span><b>' + LABEL[status] + '</b><br><span>' + (status === 'RETURNED' ? 'The shipment went back to the sender' : 'This booking was cancelled') + '</span></span><time>' + esc(fmtTime(when[status])) + '</time></div>';
    var partner = t.carrier ? '<p class="note" style="margin-top:16px">Delivered by our partner <b>' + esc(t.carrier) + '</b>' + (t.latestStatus ? ': ' + esc(t.latestStatus) + (t.latestLocation ? ' · ' + esc(t.latestLocation) : '') : '') + '</p>' : '';
    app.innerHTML = back +
      '<div class="tgrid"><div class="panel">' +
        '<div class="st-top"><div class="awb"><small>AWB number</small><div>' + esc(t.trackingNumber || t.shipmentNumber) + '</div>' + (t.shipmentNumber && t.shipmentNumber !== t.trackingNumber ? '<small>Shipment ' + esc(t.shipmentNumber) + '</small>' : '') + '</div>' +
        '<span class="pill ' + (BADGE[status] || 'p-info') + '">● ' + esc(LABEL[status] || status) + '</span></div>' +
        '<div class="route"><div><small>From</small><b>' + esc(t.fromCity || '—') + '</b></div><div class="prog" aria-hidden="true"><span style="width:' + pct + '%"></span></div><div style="text-align:right"><small>To</small><b>' + esc(t.toCity || '—') + '</b></div></div>' +
        '<div class="meta"><div><small>Booked on</small><b>' + fmtDate(t.bookingDate) + '</b></div><div><small>Expected delivery</small><b style="color:var(--success)">' + (status === 'DELIVERED' ? 'Delivered' : fmtDate(t.expectedDeliveryDate)) + '</b></div><div><small>Current status</small><b>' + esc(LABEL[status] || status) + '</b></div></div>' +
        partner + '<h2 style="font-size:18px;margin:28px 0 16px">Shipment journey</h2><div class="tl">' + steps + '</div></div>' +
      '<div style="display:grid;gap:24px"><div class="panel"><h2 style="font-size:18px">See full details</h2><p style="color:var(--muted);margin:8px 0 14px">Enter the <b>last 4 digits of the receiver\'s mobile number</b> to see addresses, current location and the proof of delivery.</p>' +
        '<form id="verify" class="row" style="display:flex;gap:10px"><label class="sr" for="last4">Last 4 digits</label><input id="last4" class="input" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="e.g. 4321" required><button class="btn btn--red" type="submit">Verify</button></form><div id="detail" style="margin-top:14px"></div></div>' +
        '<div class="panel help"><h2 style="font-size:18px">Need help?</h2><a href="#" id="complain">Raise a complaint about this shipment <span>→</span></a><a href="tel:+919370321219">Call customer care <span style="color:var(--primary-strong)">93703 21219</span></a><a href="mailto:info@occpllogistics.com">Email us <span>info@occpllogistics.com</span></a></div></div></div>';
    $('#verify').addEventListener('submit', function (e) { e.preventDefault(); verify(); });
    $('#complain').addEventListener('click', function (e) { e.preventDefault(); var d = $('#detail'); if (!d.dataset.ok) { $('#last4').focus(); d.innerHTML = '<p class="note">Verify with the last 4 digits first, then you can raise a complaint.</p>'; } else complaintForm(); });
  }
  var last4 = '';
  function verify() {
    var v = $('#last4').value.trim(), d = $('#detail');
    if (!/^\d{4}$/.test(v)) { d.innerHTML = '<div class="err">Enter exactly 4 digits.</div>'; return; }
    d.innerHTML = '<p class="hint">Checking…</p>';
    api('/track/' + encodeURIComponent(current) + '/verify', { method: 'POST', body: JSON.stringify({ phoneLast4: v }) }).then(function (r) {
      if (!r.ok) { d.innerHTML = r.status < 500 ? '<div class="err" role="alert">' + esc((r.body && r.body.message) || 'Those digits do not match this shipment.') + '</div>' : devNote('Shipment details'); return; }
      last4 = v; d.dataset.ok = '1';
      var x = r.body.data || r.body, pod = x.pod;
      d.innerHTML = '<div class="kv"><div><small>Sender</small><span>' + esc(x.senderName) + '<br>' + esc(x.senderAddress) + '</span></div><div><small>Receiver</small><span>' + esc(x.receiverName) + '<br>' + esc(x.receiverAddress) + '</span></div>' +
        (x.currentLocation ? '<div><small>Now at</small><span>' + esc(x.currentLocation) + '</span></div>' : '') + '</div>' +
        (pod ? '<h3 style="font-size:16px;margin-top:16px">Proof of delivery</h3><p class="hint">Delivered ' + esc(fmtTime(pod.deliveredAt)) + (pod.deliveredBy ? ' by ' + esc(pod.deliveredBy) : '') + '</p><div class="pod">' +
          (pod.photoUrl ? '<a href="' + esc(pod.photoUrl) + '" target="_blank" rel="noopener"><img src="' + esc(pod.photoUrl) + '" alt="Delivery photo"></a>' : '') +
          (pod.signatureUrl ? '<a href="' + esc(pod.signatureUrl) + '" target="_blank" rel="noopener"><img src="' + esc(pod.signatureUrl) + '" alt="Receiver signature"></a>' : '') + '</div>' : '') +
        ((x.tickets || []).length ? '<h3 style="font-size:16px;margin-top:16px">Your complaints</h3>' + x.tickets.map(function (k) { return '<p class="hint"><b>' + esc(k.ticketNumber) + '</b> · ' + esc(k.subject) + ' · <span class="pill p-grey">' + esc(k.status) + '</span></p>'; }).join('') : '');
    }).catch(function () { d.innerHTML = devNote('Shipment details'); });
  }
  function complaintForm() {
    var d = $('#detail');
    var box = document.createElement('form'); box.className = 'form'; box.style.marginTop = '16px';
    box.innerHTML = '<h3 style="font-size:16px">Raise a complaint</h3><label>Subject<input class="input" name="subject" maxlength="150" required></label><label>Message<textarea class="input" name="message" rows="4" maxlength="2000" required></textarea></label><button class="btn btn--red" type="submit">Send</button><div class="out"></div>';
    d.appendChild(box);
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = box.querySelector('.out'), btn = box.querySelector('button');
      btn.disabled = true;
      out.innerHTML = '<p class="hint">Sending…</p>';
      api('/track/' + encodeURIComponent(current) + '/tickets', { method: 'POST', body: JSON.stringify({ phoneLast4: last4, subject: box.subject.value.trim(), message: box.message.value.trim() }) }).then(function (r) {
        var k = r.body && (r.body.data || r.body);
        out.innerHTML = r.ok ? '<p class="pill p-green">✓ Complaint registered' + (k && k.ticketNumber ? ': ' + esc(k.ticketNumber) : '') + '. Our customer care will contact you within 3 working days.</p>' : userMsg(r) ? '<div class="err">' + esc(userMsg(r)) + '</div>' : devNote('Online complaints');
        btn.disabled = r.ok;
      }).catch(function () {
        btn.disabled = false;
        out.innerHTML = '<div class="err" role="alert">We could not confirm your complaint was received. To avoid sending it twice, press Verify again to see your complaints, or call 93703 21219.</div>';
      });
    });
  }
  // ---- several numbers: one summary row each; a row opens the full single-shipment view
  var listFrom = '';
  function backLink() {
    return listFrom ? '<p style="margin:0 0 16px"><a class="btn btn--soft" href="/track/?awb=' + encodeURIComponent(listFrom) + '">← All ' + listFrom.split(',').length + ' shipments</a></p>' : '';
  }
  function show(list) {
    if (list.length === 1) { listFrom = ''; track(list[0]); } else trackMany(list);
  }
  // One number's summary: the courier platform first, then the old system, like single tracking.
  function lookup(n) {
    return api('/track/' + encodeURIComponent(n)).then(function (r) {
      if (r.ok) {
        var t = r.body.data || r.body;
        return { found: true, status: LABEL[t.status] || t.status, badge: BADGE[t.status] || 'p-info', from: t.fromCity, to: t.toCity,
          booked: fmtDate(t.bookingDate), expected: t.status === 'DELIVERED' ? 'Delivered' : fmtDate(t.expectedDeliveryDate) };
      }
      if (r.status !== 404) return { error: userMsg(r) || (r.status === 429 ? 'Too many searches. Please wait a minute and try again.' : DEV_MSG) };
      if (!/^[A-Z0-9_-]{4,30}$/.test(n)) return { none: true };
      return request('/api/old-track/' + n, {}, OLD_TIMEOUT_MS).then(function (o) {
        if (o.status === 404) return { none: true };
        var d = o.body && o.body.internal_status, s = o.body && o.body.shipway_status;
        if (!o.ok || (!d && !s)) return { error: o.status === 429 ? 'Too many searches. Please wait a minute and try again.' : DEV_MSG };
        return { found: true, status: (d && d.action) || (s && s.current_status) || 'See details', badge: 'p-info', from: '', to: d && d.consignee_city,
          booked: fmtDate((d && d.booking_date) || (s && s.pickup_date)), expected: (s && s.extra_fields && s.extra_fields.expected_delivery_date) || '—' };
      });
    }).catch(function () { return { error: DEV_MSG }; });
  }
  function trackMany(list) {
    var key = list.join(',');
    current = key; listFrom = '';
    app.innerHTML = '<div class="panel"><div class="mt-head"><h2 style="font-size:18px">Tracking ' + list.length + ' shipments</h2><span class="hint" id="mt-count" style="margin:0">Checking…</span></div>' +
      '<ul class="mt">' + list.map(function (n, i) { return '<li id="mt-' + i + '"><div class="mt-awb"><small>AWB number</small><b>' + esc(n) + '</b></div><span class="pill p-grey">Checking…</span></li>'; }).join('') + '</ul></div>';
    var next = 0, left = list.length, found = 0;
    function row(i, x) {
      var n = list[i], li = $('#mt-' + i), head = '<div class="mt-awb"><small>AWB number</small><b>' + esc(n) + '</b></div>';
      if (x.found) {
        found++;
        li.innerHTML = '<a class="mt-link" href="/track/?awb=' + encodeURIComponent(n) + '&list=' + encodeURIComponent(key) + '">' + head +
          '<span class="pill ' + x.badge + '" style="white-space:normal;overflow-wrap:anywhere">● ' + esc(x.status) + '</span>' +
          '<div class="mt-route">' + (x.from ? '<small>From → To</small><span>' + esc(x.from) + ' → ' + esc(x.to || '—') + '</span>' : '<small>To</small><span>' + esc(x.to || '—') + '</span>') + '</div>' +
          '<div><small>Booked on</small><span>' + esc(x.booked) + '</span></div><div><small>Expected delivery</small><span>' + esc(x.expected) + '</span></div>' +
          '<span class="mt-go">Details →</span></a>';
      } else if (x.none) {
        li.innerHTML = head + '<span class="pill p-red">No shipment found</span><span class="hint mt-wide" style="margin:0">Check the number on your receipt.</span>';
      } else {
        li.innerHTML = head + '<span class="pill p-amber">Under development</span><span class="hint mt-wide" style="margin:0">' + esc(x.error) + '</span><button class="btn btn--soft mt-retry" type="button">Try again</button>';
        li.querySelector('button').addEventListener('click', function () { li.innerHTML = head + '<span class="pill p-grey">Checking…</span>'; left++; lookup(n).then(function (y) { if (current === key) row(i, y); }); });
      }
      left--;
      $('#mt-count').textContent = left > 0 ? 'Checking… ' + (list.length - left) + ' of ' + list.length : found + ' of ' + list.length + ' found';
    }
    // a few at a time, so a long list doesn't flood the tracking service
    function worker() {
      if (current !== key || next >= list.length) return;
      var i = next++;
      return lookup(list[i]).then(function (x) { if (current === key) { row(i, x); return worker(); } });
    }
    for (var w = 0; w < 4; w++) worker();
  }
  if (app) {
    var qs = new URLSearchParams(location.search), q = numbers(qs.get('awb')).slice(0, MAX_TRACK), from = numbers(qs.get('list'));
    if (q.length) {
      $$('form[data-track-form] input').forEach(function (i) { i.value = q.join(', '); });
      if (q.length === 1 && from.length > 1 && from.indexOf(q[0]) >= 0) { listFrom = from.slice(0, MAX_TRACK).join(','); track(q[0]); }
      else show(q);
    }
  }

  // ---- rate calculator: the courier platform's zone tariff (public rates API)
  var rc = $('#rate-calc');
  if (rc) {
    var rout = $('#rate-out'), rbtn = rc.querySelector('button'), rseq = 0;
    var inr = function (v) { return '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var PKG = { DOC: 'Document', NONDOC: 'Parcel', NON_DOC: 'Parcel' };
    var rerr = function (m) { rout.innerHTML = '<div class="err" role="alert" style="margin-top:18px">' + esc(m) + '</div>'; };
    rc.addEventListener('input', function () { rseq++; rout.innerHTML = ''; rbtn.disabled = false; rbtn.textContent = 'Check rates'; });
    rc.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = rc.elements, pin = /^[1-9][0-9]{5}$/, num = function (n) { return f[n].value === '' ? null : +f[n].value; };
      var bad = function (n, m) { rerr(m); f[n].focus(); };
      f.from.value = clean(f.from.value); f.to.value = clean(f.to.value);
      if (!pin.test(f.from.value)) return bad('from', 'Enter a 6-digit from pincode.');
      if (!pin.test(f.to.value)) return bad('to', 'Enter a 6-digit to pincode.');
      if (!(num('kg') > 0) || !f.kg.checkValidity()) return bad('kg', 'Enter the weight in kg, above 0, with up to 3 decimals.');
      if (num('value') === null || !f.value.checkValidity()) return bad('value', 'Enter the value of the goods in rupees.');
      if (!f.pieces.checkValidity()) { rc.querySelector('details').open = true; return bad('pieces', 'Enter the number of boxes, 1 to 999.'); }
      var my = ++rseq;
      rbtn.disabled = true; rbtn.textContent = 'Checking…';
      rout.innerHTML = '<div class="skel" style="margin-top:18px" aria-label="Loading"></div>';
      api('/public/rates', { method: 'POST', body: JSON.stringify({ originPincode: f.from.value, destinationPincode: f.to.value, actualWeightKg: num('kg'), declaredValue: num('value'),
        pieces: num('pieces') || 1, cod: f.cod.checked }) }).then(function (r) {
        if (my !== rseq) return;
        var d = r.body && (r.body.data || r.body);
        if (!r.ok || !d || !Array.isArray(d.rates)) {
          if (r.status === 429) rerr('Too many rate checks. Please wait a minute and try again.'); else if (userMsg(r)) rerr(userMsg(r)); else rout.innerHTML = devNote('The online rate check');
          return;
        }
        rout.innerHTML = '<div class="rate-grid">' + d.rates.map(function (o, i) {
          var row = function (a, b) { return '<tr><td>' + esc(a) + '</td><td>' + inr(b) + '</td></tr>'; };
          return '<article class="rate-card"><div class="rate-top"><h3>' + esc(o.service) + '</h3>' + (i === 0 ? '<span class="pill p-green">Lowest</span>' : '') + '</div>' +
            '<p>' + esc(PKG[o.packageType] || o.packageType) + (o.deliveryDays == null ? '' : ' · about ' + (o.deliveryDays === 0 ? 'same day' : esc(o.deliveryDays) + (o.deliveryDays === 1 ? ' day' : ' days'))) + (o.remoteArea ? ' · remote area' : '') + '</p>' +
            '<strong>' + inr(o.total) + '</strong><small>' + esc(o.chargeableWeightKg) + ' kg chargeable · including GST</small>' +
            '<details><summary>View breakup</summary><table>' + row('Freight', o.freight) + o.charges.map(function (c) { return row(c.name, c.amount); }).join('') +
            o.taxes.map(function (t) { return row(t.code + ' ' + t.percent + '%', t.amount); }).join('') + (+o.roundOff ? row('Round off', o.roundOff) : '') + '<tr class="sum"><td>Total</td><td>' + inr(o.total) + '</td></tr></table></details></article>';
        }).join('') + '</div><p class="hint">Estimated rates for today. The weight, size and service at booking decide the final charge and delivery date.</p>';
      }).catch(function () { if (my === rseq) rout.innerHTML = devNote('The online rate check'); })
        .then(function () { if (my === rseq) { rbtn.disabled = false; rbtn.textContent = 'Check rates'; } });
    });
  }

  // ---- volumetric weight calculator: L x W x H (cm) / divisor, for every service type
  // Each service's divisor comes from the courier platform's service types (the same divisor its rates use).
  var vol = $('#vol-calc'), volServices = null;
  if (vol) {
    var title = function (s) { return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s; };
    var calc = function () {
      if (!volServices) return;
      if (!volServices.length) { $('#vol-out').innerHTML = devNote('Volumetric weight by service'); return; }
      var l = +vol.l.value || 0, w = +vol.w.value || 0, h = +vol.h.value || 0, n = Math.max(1, +vol.n.value || 1), a = +vol.a.value || 0;
      var kg = function (x) { return x.toFixed(2) + ' kg'; };
      $('#vol-out').innerHTML = '<table class="vt"><caption>Actual weight: ' + kg(a) + '</caption><thead><tr><th scope="col">Service</th><th scope="col">Volumetric</th><th scope="col">Chargeable</th></tr></thead><tbody>' +
        volServices.map(function (s) {
          var v = l * w * h / s.divisor * n;
          // Cargo and Surface Cargo are weighed by volume in cubic feet: (L x B x H cm / 27000) x CFT factor (kg per CFT)
          var cft = /^(surface )?cargo$/i.test(s.service.trim()) ? '<small class="vt-cft">' + (l * w * h * n / 27000).toFixed(2) + ' CFT</small>' : '';
          return '<tr><th scope="row">' + esc(title(s.service)) + cft + '</th><td>' + kg(v) + '</td><td><b>' + kg(Math.max(v, a)) + '</b></td></tr>';
        }).join('') + '</tbody></table>';
    };
    vol.addEventListener('input', calc);
    $('#vol-out').innerHTML = '<div class="skel" style="margin-top:18px" aria-label="Loading"></div>';
    api('/public/rates').then(function (r) {
      var d = r.ok && r.body && (r.body.data || r.body);
      volServices = d && Array.isArray(d.divisors) ? d.divisors.filter(function (s) { return s && s.service && s.divisor > 0; }) : [];
    }, function () { volServices = []; }).then(calc);
  }
  var conv = $('#conv');
  if (conv) {
    var cv = function () { var v = +conv.v.value || 0, k = conv.u.value; var r = k === 'kg-lb' ? v * 2.20462 : k === 'lb-kg' ? v / 2.20462 : k === 'cm-in' ? v / 2.54 : v * 2.54; $('#conv-out').textContent = r.toFixed(3); };
    conv.addEventListener('input', cv); cv();
  }

})();
