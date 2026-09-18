/* ============================================================
   FG-DRAX v4 — Main Application
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs,
  query, where, deleteDoc, updateDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   FIREBASE CONFIG
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyCBpyQ2FXyIBYU55n0eRZ6TXXFOLxxdJ9Q",
  authDomain: "my-am-35e89.firebaseapp.com",
  projectId: "my-am-35e89",
  storageBucket: "my-am-35e89.firebasestorage.app",
  messagingSenderId: "445846211702",
  appId: "1:445846211702:web:bf2f7739a08e651b0f6357"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/* ADMIN UID — array, bukan string */
const ADMIN_UIDS = ["l8aEX34oWfM2u8P2rjVaV972F653"];

/* ============================================================
   KONSTANTA
   ============================================================ */
const TEMPMAIL_UUID = '1ccbf8ff-1ad7-426f-b00e-bc4db79dd558';
const TEMPMAIL_CREATE = 'https://api.tempamail.com/webapp/email/custom';
const TEMPMAIL_INBOX = 'https://api.tempamail.com/webapp/messages';

/* CORS PROXY (fallback berurutan) */
const PROXIES = [
  (u) => u, // direct
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

/* ============================================================
   STATE
   ============================================================ */
let currentUser = null;
let userDoc = null;
let currentEmail = '';
let currentEmailId = null;
let inboxData = [];
let sessionStart = Date.now();
let pollTimer = null;
let autoRefresh = true;
let musicEnabled = true;
let userApis = [];
let isAdmin = false;

/* ============================================================
   HELPERS
   ============================================================ */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function toast(msg, type = 'inf') {
  const t = $('#toast');
  t.className = 'show ' + type;
  t.textContent = msg;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = '', 3500);
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function show(el) { if (typeof el === 'string') el = document.getElementById(el); if (el) el.classList.remove('hidden'); }
function hide(el) { if (typeof el === 'string') el = document.getElementById(el); if (el) el.classList.add('hidden'); }

function debugLog(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent += `[${new Date().toLocaleTimeString('id-ID')}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

/* fetch dengan multi-proxy fallback */
async function fetchAny(url, opts = {}) {
  let lastErr;
  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const finalUrl = PROXIES[i](url);
      const res = await fetch(finalUrl, {
        ...opts,
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { /* not json */ }
      return { ok: true, data, text, proxyUsed: i };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, error: lastErr?.message || 'Semua proxy gagal', data: null, text: null };
}

/* ============================================================
   LOGIN
   ============================================================ */
function initLogin() {
  $('#btnLogin').addEventListener('click', doLogin);
  $('#inPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const email = $('#inEmail').value.trim();
  const pass = $('#inPass').value;
  const errEl = $('#loginErr');
  hide(errEl);
  errEl.textContent = '';

  if (!email || !pass) {
    errEl.textContent = 'Isi email dan password.';
    show(errEl);
    return;
  }

  const btn = $('#btnLogin');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>MEMPROSES...</span>';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // Musik start setelah user gesture (login)
    startMusic();
  } catch (e) {
    errEl.textContent = mapAuthError(e.code || e.message);
    show(errEl);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i><span>MASUK</span>';
  }
}

function mapAuthError(code) {
  if (code.includes('user-not-found')) return 'Email tidak terdaftar.';
  if (code.includes('wrong-password')) return 'Password salah.';
  if (code.includes('invalid-email')) return 'Format email tidak valid.';
  if (code.includes('too-many-requests')) return 'Terlalu banyak percobaan. Coba lagi nanti.';
  if (code.includes('network')) return 'Koneksi internet bermasalah.';
  return 'Login gagal. Cek email dan password.';
}

/* ============================================================
   AUTH STATE
   ============================================================ */
function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      show('login');
      hide('app');
      return;
    }

    currentUser = user;
    isAdmin = ADMIN_UIDS.includes(user.uid);

    // Load user doc
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) {
        userDoc = {
          username: user.email.split('@')[0],
          email: user.email,
          role: isAdmin ? 'admin' : 'user',
          limits: { email: 9999, api: 2, am: 9999 },
          stats: { emails: 0, amOk: 0, amFail: 0, amSent: 0 }
        };
        await setDoc(doc(db, 'users', user.uid), {
          ...userDoc,
          createdAt: serverTimestamp()
        });
      } else {
        userDoc = snap.data();
        // Force admin if UID match
        if (isAdmin && userDoc.role !== 'admin') {
          try {
            await updateDoc(doc(db, 'users', user.uid), { role: 'admin' });
            userDoc.role = 'admin';
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('Firestore read error:', e);
      userDoc = {
        username: user.email.split('@')[0],
        email: user.email,
        role: isAdmin ? 'admin' : 'user',
        limits: { email: 9999, api: 2, am: 9999 },
        stats: { emails: 0, amOk: 0, amFail: 0 }
      };
    }

    // Cek ban
    if (userDoc.bannedUntil) {
      const until = userDoc.bannedUntil.toMillis ? userDoc.bannedUntil.toMillis() : Number(userDoc.bannedUntil);
      if (until > Date.now()) {
        showBan(until);
        return;
      }
    }

    // Cek Eruda (kecuali admin)
    if (!isAdmin && checkEruda()) {
      const until = Date.now() + 24 * 60 * 60 * 1000;
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          bannedUntil: Timestamp.fromMillis(until),
          banReason: 'Penggunaan tools inspeksi'
        });
      } catch (e) {}
      showBan(until);
      return;
    }

    // Tampilkan app
    hide('login');
    show('app');
    bootApp();
  });
}

function checkEruda() {
  return (
    typeof window.eruda !== 'undefined' ||
    !!document.querySelector('script[src*="eruda"]') ||
    !!document.querySelector('#eruda') ||
    !!document.querySelector('.eruda-container')
  );
}

/* ============================================================
   BAN SCREEN
   ============================================================ */
function showBan(until) {
  hide('login');
  hide('app');
  show('ban');
  const t = document.getElementById('banTimer');
  const upd = () => {
    const diff = until - Date.now();
    if (diff <= 0) { location.reload(); return; }
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    t.textContent = `${h}:${m}:${s}`;
  };
  upd();
  setInterval(upd, 1000);
}

/* ============================================================
   BOOT APP
   ============================================================ */
function bootApp() {
  const name = userDoc.username || userDoc.email.split('@')[0] || 'User';
  const role = isAdmin ? 'admin' : (userDoc.role || 'user');

  document.getElementById('uName').textContent = name;
  const rb = document.getElementById('uRole');
  rb.textContent = role.toUpperCase();
  rb.className = 'badge badge-' + role;
  document.getElementById('sessRole').textContent = role.charAt(0).toUpperCase() + role.slice(1);
  if (isAdmin) show('adminCard');

  // Load storage
  currentEmail = localStorage.getItem('fgdx_email') || '';
  currentEmailId = localStorage.getItem('fgdx_email_id') || '';
  if (currentEmail) updateCurBox();

  loadHistory();
  loadLog();
  loadApis();
  updateStats();
  startSessionTimer();
  startPoll();

  // Toggles
  document.getElementById('tglAuto').addEventListener('change', (e) => {
    autoRefresh = e.target.checked;
    if (autoRefresh) startPoll();
    else stopPoll();
  });
  document.getElementById('tglMusic').addEventListener('change', (e) => {
    musicEnabled = e.target.checked;
    if (musicEnabled) startMusic();
    else stopMusic();
  });

  // Eruda loop
  setInterval(() => {
    if (!isAdmin && checkEruda()) doErudaBan();
  }, 3000);

  toast('Selamat datang, ' + name, 'ok');
}

async function doErudaBan() {
  if (!currentUser || isAdmin) return;
  const until = Date.now() + 24 * 60 * 60 * 1000;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      bannedUntil: Timestamp.fromMillis(until),
      banReason: 'Penggunaan tools inspeksi'
    });
  } catch (e) {}
  showBan(until);
}

/* ============================================================
   TAB NAVIGATION
   ============================================================ */
const TABS = ['home', 'riwayat', 'am', 'inbox', 'log', 'setelan'];

function goTab(tab) {
  TABS.forEach(t => {
    const el = document.getElementById('page-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  $$('.nav-btn, .nav-center').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

function initNav() {
  $$('.nav-btn, .nav-center').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) goTab(tab);
    });
  });
  $$('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => goTab(btn.dataset.goto));
  });
}

/* ============================================================
   SESSION TIMER
   ============================================================ */
function startSessionTimer() {
  setInterval(() => {
    const d = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(d / 3600)).padStart(2, '0');
    const m = String(Math.floor((d % 3600) / 60)).padStart(2, '0');
    const s = String(d % 60).padStart(2, '0');
    const el = document.getElementById('sessDur');
    if (el) el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

/* ============================================================
   EMAIL GENERATOR
   ============================================================ */
function initEmailGen() {
  document.getElementById('btnGen').addEventListener('click', genEmail);
  document.getElementById('btnCopyEmail').addEventListener('click', copyEmail);
  document.getElementById('btnAutoAm').addEventListener('click', autoAm);
  document.getElementById('btnRefresh').addEventListener('click', refreshInbox);
}

async function genEmail() {
  const btn = document.getElementById('btnGen');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>MEMBUAT...</span>';

  const prefix = document.getElementById('ePrefix').value.trim();
  let alias = prefix.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!alias) {
    const names = ['alex', 'jordan', 'casey', 'riley', 'taylor', 'sam', 'jamie', 'skyler', 'cameron', 'logan', 'hunter', 'sydney'];
    alias = names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 9999);
  }

  try {
    const body = new URLSearchParams();
    body.append('uuid', TEMPMAIL_UUID);
    body.append('alias', alias);
    body.append('domain_id', '2');

    const result = await fetchAny(TEMPMAIL_CREATE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://tempamail.com/',
      },
      body: body.toString()
    });

    if (result.data && result.data.email && result.data.email.id) {
      currentEmailId = result.data.email.id;
      currentEmail = result.data.email.address;
      localStorage.setItem('fgdx_email', currentEmail);
      localStorage.setItem('fgdx_email_id', currentEmailId);
      updateCurBox();
      addLog(currentEmail, currentEmailId, 'idle');
      await incStat('emails');
      toast('Email dibuat: ' + currentEmail, 'ok');
      startPoll();
    } else {
      // Fallback lokal
      const localEmail = alias + Math.floor(Math.random() * 9999) + '@lnovic.com';
      currentEmail = localEmail;
      currentEmailId = 'local_' + Date.now();
      localStorage.setItem('fgdx_email', currentEmail);
      localStorage.setItem('fgdx_email_id', currentEmailId);
      updateCurBox();
      toast('Email lokal: ' + currentEmail, 'inf');
    }
  } catch (e) {
    toast('Gagal: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-regular fa-envelope"></i><span>GENERATE EMAIL</span>';
  }
}

function updateCurBox() {
  const box = document.getElementById('curBox');
  const el = document.getElementById('curEmail');
  if (currentEmail) {
    box.style.display = 'flex';
    el.textContent = currentEmail;
  } else {
    box.style.display = 'none';
  }
}

function copyEmail() {
  if (!currentEmail) return;
  navigator.clipboard.writeText(currentEmail).then(() => toast('Email disalin', 'ok'));
}

/* ============================================================
   INBOX POLLING
   ============================================================ */
function startPoll() {
  stopPoll();
  if (!autoRefresh || !currentEmailId || currentEmailId.startsWith('local_')) return;
  pollTimer = setInterval(pollInbox, 5000);
  pollInbox();
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollInbox() {
  if (!currentEmailId || currentEmailId.startsWith('local_')) return;

  try {
    const fd = new URLSearchParams();
    fd.append('uuid', TEMPMAIL_UUID);
    fd.append('selected_email_id', currentEmailId);
    fd.append('known_message_id', '0');

    const result = await fetchAny(TEMPMAIL_INBOX, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://tempamail.com/'
      },
      body: fd.toString()
    });

    let msgs = [];
    if (result.data && result.data.messages) {
      msgs = result.data.messages
        .filter(m => parseInt(m.email_id) === parseInt(currentEmailId))
        .map(m => {
          let from = { name: m.from, address: m.from };
          try { from = JSON.parse(m.from); } catch (e) {}
          let clean = m.body || '';
          clean = clean
            .replace(/<div[^>]*>/g, '\n')
            .replace(/<\/div>/g, '')
            .replace(/<br\s*\/?>/g, '\n')
            .replace(/<[^>]*>/g, '')
            .trim();
          return {
            id: String(m.id),
            from: from,
            subject: m.subject || '(tanpa judul)',
            body: clean,
            body_html: m.body || '',
            created_at: m.created_at || 0
          };
        });
    }

    if (msgs.length > inboxData.length && inboxData.length > 0) playNotify();
    inboxData = msgs;
    renderInbox();

    const s = document.getElementById('syncState');
    if (s) s.textContent = 'Sync ' + new Date().toLocaleTimeString('id-ID');
  } catch (e) {
    const s = document.getElementById('syncState');
    if (s) s.textContent = 'Error';
  }
}

function renderInbox() {
  const el = document.getElementById('inboxList');
  const count = document.getElementById('inboxCount');
  if (count) count.textContent = inboxData.length + ' pesan';

  if (!inboxData.length) {
    el.innerHTML = '<div class="empty"><i class="fa-solid fa-satellite-dish"></i>Menunggu pesan...</div>';
    return;
  }

  el.innerHTML = inboxData.map((m, i) => {
    const from = (m.from && (m.from.name || m.from.address)) || 'Unknown';
    const time = m.created_at
      ? new Date(m.created_at * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      : '';
    return `
      <div class="msg" data-idx="${i}">
        <div class="msg-avatar">${esc((from[0] || '?').toUpperCase())}</div>
        <div class="msg-body">
          <div class="msg-from">${esc(from)}<span>${time}</span></div>
          <div class="msg-subject">${esc(m.subject)}</div>
          <div class="msg-preview">${esc((m.body || '').substring(0, 60))}</div>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.msg').forEach(item => {
    item.addEventListener('click', () => openEmail(parseInt(item.dataset.idx)));
  });
}

function openEmail(i) {
  const m = inboxData[i];
  if (!m) return;
  document.getElementById('mdSubject').textContent = m.subject || '(tanpa judul)';
  document.getElementById('mdFrom').textContent = 'Dari: ' + ((m.from && (m.from.name || m.from.address)) || 'Unknown');
  const body = m.body_html && m.body_html.includes('<') ? m.body_html : (m.body || '').replace(/\n/g, '<br>');
  document.getElementById('mdBody').innerHTML = body || '<em>Tidak ada konten</em>';
  openModal('mEmail');
}

async function refreshInbox() {
  await pollInbox();
  toast('Inbox diperbarui', 'inf');
}

/* ============================================================
   AM LOGIC (maulanabot + quietxhub, no dead APIs)
   ============================================================ */
let amBusy = false;

function initAm() {
  document.getElementById('btnAm').addEventListener('click', startAm);
  document.getElementById('btnVerify').addEventListener('click', verifyManual);
  document.getElementById('btnGuide').addEventListener('click', () => openModal('mGuide'));
}

async function startAm() {
  if (amBusy) return;
  const email = document.getElementById('amEmail').value.trim();
  if (!email || !email.includes('@')) { toast('Masukkan email valid', 'err'); return; }

  amBusy = true;
  const btn = document.getElementById('btnAm');
  const st = document.getElementById('amStatus');
  const dbg = document.getElementById('amDebug');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>MEMPROSES...</span>';
  st.className = 'status';
  st.classList.remove('hidden');
  dbg.textContent = '';
  debugLog('amDebug', 'START ' + email);

  try {
    let success = false;
    let successMethod = '';

    // --- METHOD 1: maulanabot ---
    st.textContent = 'Metode 1/2...';
    debugLog('amDebug', '[M1] maulanabot /api/cookie');
    try {
      const cookieRes = await fetchAny('https://am.maulanabot.my.id/api/cookie');
      debugLog('amDebug', '[M1] cookie status: ' + (cookieRes.data ? 'OK' : 'FAIL'));
      if (cookieRes.data && cookieRes.data.cookie) {
        debugLog('amDebug', '[M1] sending...');
        const sendRes = await fetchAny('https://am.maulanabot.my.id/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, cookie: cookieRes.data.cookie })
        });
        debugLog('amDebug', '[M1] result: ' + JSON.stringify(sendRes.data || {}).substring(0, 150));
        if (sendRes.data && (sendRes.data.ok || sendRes.data.status || sendRes.data.success)) {
          success = true;
          successMethod = 'M1';
        }
      }
    } catch (e) {
      debugLog('amDebug', '[M1] ERROR: ' + e.message);
    }

    // --- METHOD 2: quietxhub ---
    if (!success) {
      st.textContent = 'Metode 2/2...';
      debugLog('amDebug', '[M2] quietxhub /api/csrf-token');
      try {
        const csrfRes = await fetchAny('https://alight.quietxhub.my.id/api/csrf-token');
        debugLog('amDebug', '[M2] csrf status: ' + (csrfRes.data ? 'OK' : 'FAIL'));
        if (csrfRes.data && csrfRes.data.token) {
          debugLog('amDebug', '[M2] sending...');
          const sendRes = await fetchAny('https://alight.quietxhub.my.id/api/send-link', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfRes.data.token
            },
            body: JSON.stringify({ email })
          });
          debugLog('amDebug', '[M2] result: ' + JSON.stringify(sendRes.data || {}).substring(0, 150));
          if (sendRes.data && (sendRes.data.status || sendRes.data.success || sendRes.data.ok)) {
            success = true;
            successMethod = 'M2';
          }
        }
      } catch (e) {
        debugLog('amDebug', '[M2] ERROR: ' + e.message);
      }
    }

    if (success) {
      st.className = 'status ok';
      st.textContent = `✅ Magic link terkirim via ${successMethod}! Cek inbox email target.`;
      await incStat('amSent');
      toast('Magic link terkirim', 'ok');
    } else {
      st.className = 'status err';
      st.textContent = '❌ Semua metode gagal. Cek debug log untuk detail.';
      toast('Gagal kirim magic link', 'err');
    }
  } catch (e) {
    st.className = 'status err';
    st.textContent = '❌ Error: ' + e.message;
    debugLog('amDebug', 'FATAL: ' + e.message);
  } finally {
    amBusy = false;
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-play"></i><span>KIRIM MAGIC LINK</span>';
  }
}

async function verifyManual() {
  const email = document.getElementById('vEmail').value.trim();
  const link = document.getElementById('vLink').value.trim();
  const st = document.getElementById('vStatus');

  if (!email || !link) { toast('Isi email dan link', 'err'); return; }

  st.className = 'status';
  st.classList.remove('hidden');
  st.textContent = 'Memverifikasi...';

  try {
    let ok = false;

    // Try quietxhub verify
    try {
      const csrfRes = await fetchAny('https://alight.quietxhub.my.id/api/csrf-token');
      if (csrfRes.data && csrfRes.data.token) {
        const verifyRes = await fetchAny('https://alight.quietxhub.my.id/api/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfRes.data.token
          },
          body: JSON.stringify({ email, link })
        });
        if (verifyRes.data && (verifyRes.data.status || verifyRes.data.success || verifyRes.data.ok)) {
          ok = true;
        }
      }
    } catch (e) {}

    if (ok) {
      st.className = 'status ok';
      st.textContent = '✅ Verifikasi berhasil! Cek Alight Motion Anda.';
      await incStat('amOk');
      addHistory(email, 'SUCCESS');
      toast('Aktivasi berhasil!', 'ok');
    } else {
      st.className = 'status err';
      st.textContent = '❌ Verifikasi gagal. Cek link dan coba lagi.';
      await incStat('amFail');
      addHistory(email, 'FAILED');
      toast('Verifikasi gagal', 'err');
    }
  } catch (e) {
    st.className = 'status err';
    st.textContent = '❌ Error: ' + e.message;
  }
}

function autoAm() {
  if (!currentEmail) return;
  document.getElementById('amEmail').value = currentEmail;
  goTab('am');
  toast('Email dimuat: ' + currentEmail, 'inf');
}

/* ============================================================
   FIRESTORE STATS
   ============================================================ */
async function incStat(field) {
  if (!currentUser || !userDoc) return;
  try {
    const stats = userDoc.stats || { emails: 0, amOk: 0, amFail: 0, amSent: 0 };
    stats[field] = (stats[field] || 0) + 1;
    await updateDoc(doc(db, 'users', currentUser.uid), { stats });
    userDoc.stats = stats;
    updateStats();
  } catch (e) {}
}

function updateStats() {
  const s = (userDoc && userDoc.stats) || {};
  const e1 = document.getElementById('sEmail');
  const e2 = document.getElementById('sOk');
  const e3 = document.getElementById('sFail');
  const e4 = document.getElementById('sApi');
  if (e1) e1.textContent = s.emails || 0;
  if (e2) e2.textContent = s.amOk || 0;
  if (e3) e3.textContent = s.amFail || 0;
  if (e4) e4.textContent = userApis.length;
}

/* ============================================================
   LOG & HISTORY
   ============================================================ */
function initLog() {
  document.getElementById('btnClearLog').addEventListener('click', clearLog);
  document.getElementById('btnClearHistory').addEventListener('click', clearHistory);
}

function loadLog() {
  const log = JSON.parse(localStorage.getItem('fgdx_log') || '[]');
  renderLog(log);
}

function addLog(email, id, status) {
  const log = JSON.parse(localStorage.getItem('fgdx_log') || '[]');
  log.unshift({ email, id, status, at: Date.now() });
  localStorage.setItem('fgdx_log', JSON.stringify(log.slice(0, 30)));
  loadLog();
}

function renderLog(log) {
  const el = document.getElementById('logList');
  if (!el) return;
  if (!log.length) {
    el.innerHTML = '<div class="empty"><i class="fa-regular fa-file-lines"></i>Belum ada log email</div>';
    return;
  }
  el.innerHTML = log.map(item => {
    const ic = item.status === 'success'
      ? '<i class="fa-solid fa-circle-check" style="color:#4ade80"></i>'
      : item.status === 'failed'
      ? '<i class="fa-solid fa-circle-xmark" style="color:#f87171"></i>'
      : '<i class="fa-regular fa-clock" style="color:#64748b"></i>';
    const t = new Date(item.at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return `<div class="log-item"><div class="info"><div class="email">${esc(item.email)}</div><div class="date">${t}</div></div><div class="status-icon">${ic}</div></div>`;
  }).join('');
}

function clearLog() {
  if (!confirm('Hapus semua log?')) return;
  localStorage.removeItem('fgdx_log');
  loadLog();
  toast('Log dihapus', 'inf');
}

function loadHistory() {
  const h = JSON.parse(localStorage.getItem('fgdx_history') || '[]');
  renderHistory(h);
}

function addHistory(email, status) {
  const h = JSON.parse(localStorage.getItem('fgdx_history') || '[]');
  h.unshift({ email, status, at: Date.now() });
  localStorage.setItem('fgdx_history', JSON.stringify(h.slice(0, 50)));
  loadHistory();
}

function renderHistory(h) {
  const el = document.getElementById('historyList');
  if (!el) return;
  if (!h.length) {
    el.innerHTML = '<div class="empty"><i class="fa-regular fa-clock"></i>Belum ada riwayat</div>';
    return;
  }
  el.innerHTML = h.map(item => {
    const c = item.status === 'SUCCESS' ? '#4ade80' : '#f87171';
    const t = new Date(item.at).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="log-item"><div class="info"><div class="email">${esc(item.email)}</div><div class="date">${t}</div></div><div class="status-text" style="color:${c}">${item.status}</div></div>`;
  }).join('');
}

function clearHistory() {
  if (!confirm('Hapus semua riwayat?')) return;
  localStorage.removeItem('fgdx_history');
  loadHistory();
  toast('Riwayat dihapus', 'inf');
}

/* ============================================================
   API MANAGEMENT
   ============================================================ */
function initApi() {
  document.getElementById('btnCreateApi').addEventListener('click', createApi);
}

async function loadApis() {
  if (!currentUser) return;
  try {
    const q = query(collection(db, 'api_keys'), where('userId', '==', currentUser.uid));
    const snap = await getDocs(q);
    userApis = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    userApis = [];
  }
  renderApis();
  updateStats();
}

function renderApis() {
  const el = document.getElementById('apiList');
  if (!el) return;
  if (!userApis.length) {
    el.innerHTML = '<div class="empty"><i class="fa-solid fa-key"></i>Belum ada API</div>';
    return;
  }
  el.innerHTML = userApis.map(a => `
    <div class="api">
      <div class="api-head">
        <span class="api-name">${esc(a.name)}</span>
        <button class="icon-btn" data-del="${a.id}" style="width:32px;height:32px;font-size:12px">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </div>
      <div class="api-key">${esc(a.key)}</div>
      <div class="api-endpoint">Endpoint: <code>/api/v1/send</code> & <code>/api/v1/verify</code></div>
      <div class="row">
        <button class="btn btn-ghost" data-copy="${a.key}" style="flex:1;font-size:11px;padding:8px">
          <i class="fa-regular fa-copy"></i> Copy Key
        </button>
        <button class="btn btn-ghost" id="btnCopyEp" style="flex:1;font-size:11px;padding:8px">
          <i class="fa-solid fa-link"></i> Copy URL
        </button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', () => delApi(b.dataset.del));
  });
  el.querySelectorAll('[data-copy]').forEach(b => {
    b.addEventListener('click', () => {
      navigator.clipboard.writeText(b.dataset.copy);
      toast('API key disalin', 'ok');
    });
  });
  el.querySelectorAll('#btnCopyEp').forEach(b => {
    b.addEventListener('click', () => {
      const base = window.location.origin;
      navigator.clipboard.writeText(`${base}/api/v1/send\n${base}/api/v1/verify`);
      toast('Endpoint disalin', 'ok');
    });
  });
}

async function createApi() {
  if (!currentUser) return;
  const limit = (userDoc && userDoc.limits && userDoc.limits.api) || 2;
  if (userApis.length >= limit) { toast(`Maksimal ${limit} API`, 'err'); return; }

  const name = prompt('Nama API:', 'Web Saya');
  if (!name) return;

  const key = 'fgdx_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  try {
    await addDoc(collection(db, 'api_keys'), {
      userId: currentUser.uid,
      name: name.slice(0, 40),
      key,
      createdAt: serverTimestamp(),
      usage: { send: 0, verify: 0 }
    });
    await loadApis();
    toast('API dibuat', 'ok');
  } catch (e) {
    toast('Gagal: ' + e.message, 'err');
  }
}

async function delApi(id) {
  if (!confirm('Hapus API ini?')) return;
  try {
    await deleteDoc(doc(db, 'api_keys', id));
    await loadApis();
    toast('API dihapus', 'inf');
  } catch (e) {
    toast('Gagal', 'err');
  }
}

/* ============================================================
   NOTIF SOUND
   ============================================================ */
function playNotify() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch (e) {}
}

/* ============================================================
   MUSIC (YouTube IFrame API)
   ============================================================ */
let ytPlayer = null;
let ytReady = false;

function loadYT() {
  if (window.YT && window.YT.Player) { initYT(); return; }
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function () { initYT(); };

function initYT() {
  if (ytReady) return;
  try {
    ytPlayer = new YT.Player('ytPlayer', {
      height: '1',
      width: '1',
      videoId: '5cTAbrpGOTk',
      playerVars: {
        autoplay: 1,
        controls: 0,
        loop: 1,
        playlist: '5cTAbrpGOTk',
        playsinline: 1,
        modestbranding: 1
      },
      events: {
        onReady: (e) => {
          ytReady = true;
          try { e.target.setVolume(30); } catch (err) {}
          if (musicEnabled) playYT();
        }
      }
    });
  } catch (e) {}
}

function playYT() {
  if (!ytPlayer || !ytReady) return;
  try { ytPlayer.playVideo(); } catch (e) {}
}

function stopMusic() {
  if (ytPlayer && ytReady) { try { ytPlayer.pauseVideo(); } catch (e) {} }
}

function startMusic() {
  if (!musicEnabled) return;
  if (!ytReady) { loadYT(); return; }
  playYT();
}

/* ============================================================
   ANTI DEVTOOLS (basic)
   ============================================================ */
function initAntiDevtools() {
  document.addEventListener('contextmenu', (e) => {
    if (!isAdmin) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (isAdmin) return;
    if (e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) ||
        (e.ctrlKey && e.key === 'U')) {
      e.preventDefault();
      toast('Dev tools dilarang!', 'err');
    }
  });
}

/* ============================================================
   MODAL CLOSE (backdrop + button)
   ============================================================ */
function initModals() {
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.remove('open');
    });
  });
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
}

/* ============================================================
   BOOT SEQUENCE
   ============================================================ */
function initBoot() {
  const msgEl = document.getElementById('bootMsg');
  const messages = [
    'Memuat sistem...',
    'Menghubungkan Firebase...',
    'Menyiapkan UI...',
    'Selesai!'
  ];
  let i = 0;
  const iv = setInterval(() => {
    if (msgEl && i < messages.length) msgEl.textContent = messages[i++];
    if (i >= messages.length) clearInterval(iv);
  }, 800);

  setTimeout(() => {
    const b = document.getElementById('boot');
    if (b) {
      b.classList.add('out');
      setTimeout(() => b.classList.add('hidden'), 700);
    }
  }, 3200);
}

/* ============================================================
   LOGOUT
   ============================================================ */
function initLogout() {
  document.getElementById('btnLogout').addEventListener('click', async () => {
    if (!confirm('Keluar dari akun?')) return;
    try { await signOut(auth); } catch (e) {}
    location.reload();
  });
}

/* ============================================================
   INIT ALL
   ============================================================ */
function init() {
  initBoot();
  initLogin();
  initAuth();
  initNav();
  initEmailGen();
  initAm();
  initLog();
  initApi();
  initModals();
  initAntiDevtools();
  initLogout();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}