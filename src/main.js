import './style.css';
import { configOk, db, ensureUser } from './firebase.js';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { t } from './i18n.js';
import { blobToDataURL, compressImage, startRecording, voiceTooBig } from './media.js';

const app = document.getElementById('app');
const MESSAGE_LIMIT = 60;
const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
const POKE_COOLDOWN_MS = 8000;
const POKE_BUZZ = [350, 120, 350, 120, 700];

let user = null;
let member = null;
let unsub = null;
let unsubMembers = null;

/* ---------- small helpers ---------- */

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

/* Inline icons: static markup written here, never user input. */
const ICONS = {
  camera:
    '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  heart: '<path d="M12 21s-7-4.6-9.3-9.1C1.2 8.8 3 5 6.5 5c2 0 3.6 1.2 5.5 3 1.9-1.8 3.5-3 5.5-3 3.5 0 5.3 3.8 3.8 6.9C19 16.4 12 21 12 21z" fill="currentColor" stroke="none"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
};

function icon(name) {
  const span = h('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

function setIcon(btn, name) {
  btn.replaceChildren(icon(name));
}

/* The app's logo: a family of three, drawn as simple shapes so it stays sharp at any size. */
const LOGO_SVG =
  '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Our Family">' +
  '<rect width="128" height="128" rx="34" fill="#262a5c"/>' +
  '<circle cx="64" cy="72" r="50" fill="#2f3480" opacity=".55"/>' +
  '<circle cx="40" cy="56" r="11" fill="#a3aaf0"/>' +
  '<path d="M20 104V90a20 20 0 0 1 40 0v14a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8z" fill="#a3aaf0"/>' +
  '<circle cx="88" cy="56" r="11" fill="#ff6f4f"/>' +
  '<path d="M68 104V90a20 20 0 0 1 40 0v14a8 8 0 0 1-8 8H76a8 8 0 0 1-8-8z" fill="#ff6f4f"/>' +
  '<g fill="#f2b134" stroke="#262a5c" stroke-width="4" stroke-linejoin="round">' +
  '<circle cx="64" cy="76" r="9"/>' +
  '<path d="M49 112v-8a15 15 0 0 1 30 0v8z"/></g>' +
  '<path d="M64 44C48 33 48 18 58 18c3.5 0 6 2.5 6 5 0-2.5 2.5-5 6-5 10 0 10 15-6 26z" fill="#ff6f4f"/>' +
  '<path d="M100 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM27 30l1.5 3.5 3.5 1.5-3.5 1.5L27 40l-1.5-3.5L22 35l3.5-1.5z" fill="#f2b134"/>' +
  '</svg>';

function logo(extraClass = '') {
  const span = h('span', { class: `logo ${extraClass}`.trim() });
  span.innerHTML = LOGO_SVG;
  return span;
}

function siteFooter(extraClass = '') {
  return h(
    'footer',
    { class: `site-foot ${extraClass}`.trim() },
    h('p', { class: 'foot-made' }, t('footMade'), h('span', { class: 'foot-heart' }, icon('heart'))),
    h('p', { class: 'foot-sub' }, t('footPrivate'))
  );
}

function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

function hueFor(name) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.codePointAt(0)) % 360;
  return n;
}

/* Each person gets their own colour, used for their avatar and name. */
function avatar(name, extraClass = '') {
  const clean = (name || '?').trim();
  const initial = ([...clean][0] || '?').toUpperCase();
  return h(
    'span',
    { class: `avatar ${extraClass}`.trim(), style: `--h:${hueFor(clean)}`, 'aria-hidden': 'true' },
    initial
  );
}

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtStamp = (d) =>
  d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function dayLabel(d) {
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('today');
  if (d.toDateString() === yest.toDateString()) return t('yesterday');
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function previewOf(m) {
  if (m.type === 'image') return t('photoPreview');
  if (m.type === 'voice') return t('voicePreview');
  return (m.text || '').slice(0, 90);
}

function stopListeners() {
  unsub?.();
  unsub = null;
  unsubMembers?.();
  unsubMembers = null;
}

/* ---------- alerts: vibration and background notifications ---------- */

function registerWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function askAlerts() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch {
    /* ignore */
  }
}

async function notify(body, strong) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    reg.showNotification(t('appName'), {
      body,
      tag: strong ? 'poke' : 'message',
      renotify: true,
      vibrate: strong ? POKE_BUZZ : [150],
    });
  } catch {
    /* ignore */
  }
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

/* ---------- screens ---------- */

function renderLoading() {
  stopListeners();
  app.replaceChildren(
    h(
      'div',
      { class: 'welcome' },
      h('div', { class: 'loading-wrap' }, logo('logo-md pulse'), h('p', { class: 'loading' }, t('loading')))
    )
  );
}

function renderFatal(message, detail) {
  app.replaceChildren(
    h(
      'div',
      { class: 'welcome' },
      h(
        'div',
        { class: 'card' },
        h('h1', { class: 'display fatal' }, t('fatalTitle')),
        h('p', {}, message),
        detail ? h('p', { class: 'muted small' }, detail) : null,
        h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, t('retry'))
      )
    )
  );
}

function showJoin(errorMessage = '') {
  stopListeners();

  const nameInput = h('input', {
    id: 'name',
    type: 'text',
    maxlength: '30',
    autocomplete: 'given-name',
    placeholder: t('namePlaceholder'),
  });
  const codeInput = h('input', {
    id: 'code',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: t('codePlaceholder'),
  });
  const error = h('p', { class: 'error', role: 'alert' }, errorMessage);
  const submit = h('button', { class: 'btn primary', type: 'submit' }, t('join'));

  const form = h(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const code = codeInput.value.trim();
        if (!name) return (error.textContent = t('nameNeeded'));
        if (!code) return (error.textContent = t('codeNeeded'));
        error.textContent = '';
        submit.disabled = true;
        submit.textContent = t('joining');
        askAlerts();
        try {
          await setDoc(doc(db, 'members', user.uid), { name, code, joinedAt: serverTimestamp() });
          member = { name };
          showChat();
        } catch (err) {
          console.error(err);
          error.textContent = err.code === 'permission-denied' ? t('wrongCode') : t('joinFailed');
          submit.disabled = false;
          submit.textContent = t('join');
        }
      },
    },
    h('p', { class: 'eyebrow' }, t('eyebrowJoin')),
    h('h1', { class: 'display' }, t('appName')),
    h('p', { class: 'tagline' }, t('tagline')),
    h('label', { for: 'name' }, t('yourName')),
    nameInput,
    h('label', { for: 'code' }, t('inviteCode')),
    codeInput,
    error,
    submit,
    h('div', { class: 'perf', 'aria-hidden': 'true' }),
    h('p', { class: 'foot' }, t('joinFoot'))
  );

  app.replaceChildren(
    h(
      'div',
      { class: 'welcome' },
      h('div', { class: 'gate' }, h('div', { class: 'art' }, logo('logo-lg')), form),
      siteFooter()
    )
  );
  nameInput.focus();
}

function confirmLogout() {
  const sheet = h(
    'div',
    { class: 'sheet-back', role: 'dialog', 'aria-label': t('logoutTitle'), onclick: () => sheet.remove() },
    h(
      'div',
      { class: 'sheet', onclick: (e) => e.stopPropagation() },
      h('h2', {}, t('logoutTitle')),
      h('p', { class: 'muted' }, t('logoutHint')),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => sheet.remove() }, t('cancel')),
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            onclick: () => {
              sheet.remove();
              logout();
            },
          },
          t('logout')
        )
      )
    )
  );
  document.body.append(sheet);
}

async function logout() {
  stopListeners();
  try {
    await deleteDoc(doc(db, 'members', user.uid));
    member = null;
    showJoin();
  } catch (err) {
    console.error(err);
    showChat();
    toast(t('logoutFailed'));
  }
}

function showChat() {
  stopListeners();
  document.title = t('appName');

  let members = [];
  const names = new Map();
  const rows = new Map(); // message id -> { id, m, el, wrap, reacts }
  let replyTarget = null;
  let lastPoke = 0;
  let picker = null;

  const list = h('main', { class: 'list', 'aria-live': 'polite' });
  const emptyNote = h(
    'div',
    { class: 'empty' },
    h('span', { class: 'empty-ico' }, icon('chat')),
    h('p', {}, t('empty'))
  );
  list.append(emptyNote);

  /* header */
  const membersBtn = h('button', { class: 'members-btn', type: 'button' });

  function renderMembers() {
    const shown = members.slice(0, 4);
    const extra = members.length - shown.length;
    membersBtn.replaceChildren(
      h(
        'span',
        { class: 'stack' },
        shown.map((m) => avatar(m.name, 'sm')),
        extra > 0 ? h('span', { class: 'avatar sm more' }, `+${extra}`) : null
      ),
      h('span', { class: 'members-count' }, t('members', members.length))
    );
  }

  function openMembers() {
    const sheet = h(
      'div',
      { class: 'sheet-back', role: 'dialog', 'aria-label': t('membersTitle'), onclick: () => sheet.remove() },
      h(
        'div',
        { class: 'sheet', onclick: (e) => e.stopPropagation() },
        h('h2', {}, t('membersTitle')),
        h(
          'ul',
          {},
          members.map((m) =>
            h(
              'li',
              {},
              avatar(m.name),
              h('span', { class: 'who' }, m.name),
              m.uid === user.uid ? h('span', { class: 'you-tag' }, t('you')) : null
            )
          )
        ),
        h('button', { class: 'btn primary', type: 'button', onclick: () => sheet.remove() }, t('close'))
      )
    );
    document.body.append(sheet);
  }
  membersBtn.addEventListener('click', openMembers);

  const chat = h('div', { class: 'chat' });

  const pokeBtn = h(
    'button',
    { class: 'poke-btn', type: 'button', 'aria-label': t('pokeLabel'), title: t('pokeLabel') },
    h('span', { class: 'poke-emoji', 'aria-hidden': 'true' }, '👉'),
    h('span', { class: 'poke-text' }, t('poke'))
  );

  const header = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'brandbar' },
      logo('logo-sm'),
      h('div', { class: 'titles' }, h('h1', { class: 'chat-title' }, t('appName')), membersBtn)
    ),
    h(
      'div',
      { class: 'tools' },
      pokeBtn,
      h(
        'button',
        { class: 'chip', type: 'button', 'aria-label': t('logout'), title: t('logout'), onclick: confirmLogout },
        icon('logout'),
        h('span', { class: 'logout-text' }, t('logout'))
      )
    )
  );
  members = [{ uid: user.uid, name: member.name }];
  names.set(user.uid, member.name);
  renderMembers();

  /* composer */
  const textarea = h('textarea', {
    class: 'input',
    rows: '1',
    placeholder: t('placeholder'),
    'aria-label': t('placeholder'),
  });
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });

  const photoBtn = h('button', { class: 'round', type: 'button', 'aria-label': t('photo'), title: t('photo') }, icon('camera'));
  const micBtn = h('button', { class: 'round gold', type: 'button', 'aria-label': t('voice'), title: t('voice') }, icon('mic'));
  const sendBtn = h('button', { class: 'round go hidden', type: 'button', 'aria-label': t('send'), title: t('send') }, icon('send'));

  const normalBar = h('div', { class: 'bar' }, photoBtn, textarea, micBtn, sendBtn, fileInput);

  const recDot = h('span', { class: 'rec-dot', 'aria-hidden': 'true' });
  const recTime = h('span', { class: 'rec-time' }, '0:00');
  const recCancel = h('button', { class: 'btn ghost', type: 'button' }, t('cancel'));
  const recSend = h('button', { class: 'btn primary', type: 'button' }, t('sendVoice'));
  const recBar = h(
    'div',
    { class: 'bar rec hidden' },
    recDot,
    h('span', { class: 'rec-label' }, t('recording')),
    recTime,
    recCancel,
    recSend
  );

  /* reply bar (shows above the input while replying) */
  const replyName = h('span', { class: 'reply-name' });
  const replyText = h('span', { class: 'reply-text' });
  const replyBar = h(
    'div',
    { class: 'replybar hidden' },
    h('div', { class: 'reply-body' }, replyName, replyText),
    h('button', { class: 'reply-x', type: 'button', 'aria-label': t('cancelReply'), title: t('cancelReply'), onclick: () => clearReply() }, icon('x'))
  );

  const composer = h('footer', { class: 'composer' }, replyBar, normalBar, recBar);

  const jump = h(
    'button',
    { class: 'jump hidden', type: 'button', 'aria-label': t('latest'), title: t('latest'), onclick: () => scrollBottom() },
    icon('down')
  );
  chat.append(header, h('div', { class: 'list-wrap' }, list, jump), composer);
  app.replaceChildren(h('div', { class: 'chat-page' }, chat, siteFooter('slim')));

  function startReply(entry) {
    replyTarget = { id: entry.id, name: entry.m.name || '', preview: previewOf(entry.m) };
    replyName.textContent = t('replyingTo', replyTarget.name);
    replyText.textContent = replyTarget.preview;
    replyBar.classList.remove('hidden');
    textarea.focus();
  }
  function clearReply() {
    replyTarget = null;
    replyBar.classList.add('hidden');
  }

  /* --- composer behaviour --- */
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const refreshButtons = () => {
    const has = textarea.value.trim().length > 0;
    sendBtn.classList.toggle('hidden', !has);
    micBtn.classList.toggle('hidden', has);
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  };
  textarea.addEventListener('input', refreshButtons);

  const post = (payload, opts = {}) => {
    const data = {
      uid: user.uid,
      name: member.name,
      createdAt: serverTimestamp(),
      ...payload,
    };
    if (replyTarget && !opts.noReply) {
      data.replyTo = replyTarget;
      clearReply();
    }
    return addDoc(collection(db, 'messages'), data).catch((err) => {
      console.error(err);
      toast(t('sendFailed'));
    });
  };

  const sendText = () => {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    refreshButtons();
    post({ type: 'text', text });
  };
  sendBtn.addEventListener('click', sendText);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault();
      sendText();
    }
  });

  /* poke: buzzes everyone else's phone */
  pokeBtn.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastPoke < POKE_COOLDOWN_MS) return toast(t('pokeWait'));
    lastPoke = now;
    askAlerts();
    pokeBtn.classList.remove('wiggle');
    void pokeBtn.offsetWidth;
    pokeBtn.classList.add('wiggle');
    vibrate(40);
    post({ type: 'poke', text: '' }, { noReply: true });
  });

  photoBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    toast(t('photoWorking'));
    try {
      const data = await compressImage(file);
      post({ type: 'image', text: '', data });
    } catch (err) {
      console.error(err);
      toast(t('photoFailed'));
    }
  });

  /* voice recording */
  let recorder = null;

  const showRecording = (on) => {
    normalBar.classList.toggle('hidden', on);
    recBar.classList.toggle('hidden', !on);
  };

  const finishRecording = async () => {
    if (!recorder) return;
    const r = recorder;
    recorder = null;
    showRecording(false);
    const result = await r.stop();
    if (!result) return;
    if (result.seconds < 1) return toast(t('tooShort'));
    try {
      const data = await blobToDataURL(result.blob);
      if (voiceTooBig(data)) return toast(t('sendFailed'));
      post({ type: 'voice', text: '', data, dur: result.dur });
    } catch (err) {
      console.error(err);
      toast(t('sendFailed'));
    }
  };

  micBtn.addEventListener('click', async () => {
    if (recorder) return;
    try {
      recorder = await startRecording({
        onTick: (s) => (recTime.textContent = fmtDur(s)),
        onLimit: finishRecording,
      });
      recTime.textContent = '0:00';
      showRecording(true);
    } catch (err) {
      console.error(err);
      recorder = null;
      toast(err.code === 'unsupported' ? t('micUnsupported') : t('micDenied'));
    }
  });
  recCancel.addEventListener('click', () => {
    if (!recorder) return;
    recorder.cancel();
    recorder = null;
    showRecording(false);
  });
  recSend.addEventListener('click', finishRecording);

  /* --- messages --- */
  let lastDay = '';
  let lastMsg = null;
  let stickBottom = true;
  let firstSnapshot = true;
  let currentAudio = null;

  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  const scrollBottom = () => {
    list.scrollTop = list.scrollHeight;
  };
  list.addEventListener('scroll', () => {
    stickBottom = nearBottom();
    jump.classList.toggle('hidden', stickBottom);
  });

  function closePicker() {
    picker?.remove();
    picker = null;
  }
  list.addEventListener('click', closePicker);

  function openLightbox(src) {
    const box = h(
      'div',
      { class: 'lightbox', role: 'dialog', 'aria-label': t('close'), onclick: () => box.remove() },
      h('img', { src, alt: '' }),
      h('button', { class: 'btn primary', type: 'button' }, t('close'))
    );
    document.body.append(box);
  }

  function voicePlayer(m) {
    const total = m.dur || 1;
    let audio = null;
    const btn = h('button', { class: 'vp-btn', type: 'button', 'aria-label': t('play') }, icon('play'));
    const fill = h('div', { class: 'vp-fill' });
    const time = h('span', { class: 'vp-time' }, fmtDur(total));

    const reset = () => {
      setIcon(btn, 'play');
      btn.setAttribute('aria-label', t('play'));
      fill.style.width = '0%';
      time.textContent = fmtDur(total);
    };

    btn.addEventListener('click', () => {
      if (!audio) {
        audio = new Audio(m.data);
        audio.addEventListener('timeupdate', () => {
          fill.style.width = `${Math.min(100, (audio.currentTime / total) * 100)}%`;
          time.textContent = fmtDur(audio.currentTime);
        });
        audio.addEventListener('play', () => {
          setIcon(btn, 'pause');
          btn.setAttribute('aria-label', t('pause'));
        });
        audio.addEventListener('pause', () => {
          if (!audio.ended) {
            setIcon(btn, 'play');
            btn.setAttribute('aria-label', t('play'));
          }
        });
        audio.addEventListener('ended', reset);
      }
      if (audio.paused) {
        if (currentAudio && currentAudio !== audio) currentAudio.pause();
        currentAudio = audio;
        audio.play().catch(() => toast(t('sendFailed')));
      } else {
        audio.pause();
      }
    });

    return h('div', { class: 'vp' }, btn, h('div', { class: 'vp-bar' }, fill), time);
  }

  /* reactions */
  function renderReactions(entry) {
    const r = entry.m.reactions || {};
    const mineEmoji = r[user.uid];
    const groups = new Map();
    for (const [uid, emoji] of Object.entries(r)) {
      if (!groups.has(emoji)) groups.set(emoji, []);
      groups.get(emoji).push(names.get(uid) || t('someone'));
    }
    entry.reacts.replaceChildren(
      ...[...groups].map(([emoji, who]) =>
        h(
          'button',
          {
            class: `react${emoji === mineEmoji ? ' on' : ''}`,
            type: 'button',
            title: who.join(', '),
            'aria-label': `${emoji} ${who.join(', ')}`,
            onclick: () => setReaction(entry.id, emoji, entry.m.reactions?.[user.uid]),
          },
          emoji,
          who.length > 1 ? h('span', { class: 'react-n' }, String(who.length)) : null
        )
      )
    );
    entry.reacts.classList.toggle('hidden', groups.size === 0);
  }

  function setReaction(id, emoji, current) {
    updateDoc(doc(db, 'messages', id), {
      [`reactions.${user.uid}`]: current === emoji ? deleteField() : emoji,
    }).catch((err) => {
      console.error(err);
      toast(t('reactFailed'));
    });
  }

  function openPicker(entry) {
    closePicker();
    picker = h(
      'div',
      { class: 'picker', role: 'menu' },
      REACTIONS.map((emoji) =>
        h(
          'button',
          {
            class: 'pick',
            type: 'button',
            'aria-label': emoji,
            onclick: (e) => {
              e.stopPropagation();
              closePicker();
              setReaction(entry.id, emoji, entry.m.reactions?.[user.uid]);
            },
          },
          emoji
        )
      )
    );
    entry.wrap.append(picker);
    picker.scrollIntoView({ block: 'nearest' });
  }

  function jumpTo(id) {
    const target = rows.get(id);
    if (!target) return toast(t('originalGone'));
    target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.el.classList.remove('flash');
    void target.el.offsetWidth;
    target.el.classList.add('flash');
    setTimeout(() => target.el.classList.remove('flash'), 1300);
  }

  function buildMessage(id, m, pending, cont = false) {
    const mine = m.uid === user.uid;
    const date = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
    const name = m.name || '';

    if (m.type === 'poke') {
      const el = h(
        'div',
        { class: `poke-pill${pending ? ' pending' : ''}`, 'data-id': id },
        `${t('poked', mine ? t('you') : name)} 👉 · ${fmtStamp(date)}`
      );
      return { id, m, el, wrap: el, reacts: h('div') };
    }

    let body;
    if (m.type === 'image') {
      const img = h('img', { class: 'photo', src: m.data, alt: `Photo from ${name}`, loading: 'lazy' });
      img.addEventListener('click', () => openLightbox(m.data));
      img.addEventListener('load', () => stickBottom && scrollBottom());
      body = img;
    } else if (m.type === 'voice') {
      body = voicePlayer(m);
    } else {
      body = h('div', { class: 'text' }, m.text || '');
    }

    const quote = m.replyTo
      ? h(
          'button',
          { class: 'quote', type: 'button', onclick: () => jumpTo(m.replyTo.id) },
          h('span', { class: 'quote-name' }, m.replyTo.name || ''),
          h('span', { class: 'quote-text' }, m.replyTo.preview || '')
        )
      : null;

    const bubble = h(
      'div',
      { class: 'msg', style: `--h:${hueFor(name)}` },
      mine || cont ? null : h('div', { class: 'sender' }, name),
      quote,
      body,
      h('div', { class: 'meta' }, mine ? `${t('you')} · ${fmtStamp(date)}` : fmtStamp(date))
    );

    const reacts = h('div', { class: 'reacts hidden' });
    const wrap = h('div', { class: 'msg-wrap' });
    const el = h(
      'div',
      { class: `row ${mine ? 'mine' : 'theirs'}${cont ? ' cont' : ''}${pending ? ' pending' : ''}`, 'data-id': id },
      mine ? null : cont ? h('span', { class: 'avatar-gap' }) : avatar(name),
      wrap
    );
    const entry = { id, m, el, wrap, reacts };

    const actions = h(
      'div',
      { class: 'actions' },
      h('button', { class: 'act', type: 'button', 'aria-label': t('reply'), title: t('reply'), onclick: () => startReply(entry) }, icon('reply')),
      h(
        'button',
        {
          class: 'act',
          type: 'button',
          'aria-label': t('react'),
          title: t('react'),
          onclick: (e) => {
            e.stopPropagation();
            openPicker(entry);
          },
        },
        icon('smile')
      ),
      mine
        ? h(
            'button',
            {
              class: 'act',
              type: 'button',
              'aria-label': t('del'),
              title: t('del'),
              onclick: () => {
                if (confirm(t('delConfirm'))) {
                  deleteDoc(doc(db, 'messages', id)).catch((err) => {
                    console.error(err);
                    toast(t('sendFailed'));
                  });
                }
              },
            },
            icon('trash')
          )
        : null
    );

    wrap.append(bubble, reacts, actions);
    renderReactions(entry);
    return entry;
  }

  function appendMessage(id, m, pending) {
    emptyNote.remove();
    const date = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
    const key = date.toDateString();
    const sameDay = key === lastDay;
    if (!sameDay) {
      lastDay = key;
      list.append(h('div', { class: 'day' }, h('span', {}, dayLabel(date))));
    }
    const cont =
      sameDay &&
      lastMsg &&
      lastMsg.uid === m.uid &&
      lastMsg.type !== 'poke' &&
      m.type !== 'poke' &&
      date - lastMsg.date < 5 * 60 * 1000;
    lastMsg = { uid: m.uid, type: m.type, date };
    const entry = buildMessage(id, m, pending, cont);
    rows.set(id, entry);
    list.append(entry.el);
    if (stickBottom || m.uid === user.uid) scrollBottom();
  }

  function incoming(m) {
    const date = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
    if (Date.now() - date.getTime() > 90000) return; // ignore old messages
    if (m.type === 'poke') {
      vibrate(POKE_BUZZ);
      chat.classList.remove('buzz');
      void chat.offsetWidth;
      chat.classList.add('buzz');
      if (document.hidden) {
        document.title = `● ${t('poked', m.name)}`;
        notify(`${m.name} poked you 👉`, true);
      }
    } else if (document.hidden) {
      document.title = `● ${t('newTitle')}`;
      vibrate(150);
      notify(`${m.name}: ${previewOf(m)}`, false);
    }
  }

  /* who is in the family (for the header and the members list) */
  unsubMembers = onSnapshot(
    collection(db, 'members'),
    (snap) => {
      members = snap.docs
        .map((d) => ({ uid: d.id, name: d.data().name }))
        .filter((m) => m.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!members.some((m) => m.uid === user.uid)) members.unshift({ uid: user.uid, name: member.name });
      names.clear();
      members.forEach((m) => names.set(m.uid, m.name));
      renderMembers();
      rows.forEach(renderReactions);
    },
    (err) => console.error(err)
  );

  const q = query(collection(db, 'messages'), orderBy('createdAt'), limitToLast(MESSAGE_LIMIT));

  unsub = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      snap.docChanges().forEach((ch) => {
        const id = ch.doc.id;
        const m = ch.doc.data({ serverTimestamps: 'estimate' });
        const pending = ch.doc.metadata.hasPendingWrites;
        if (ch.type === 'added') {
          appendMessage(id, m, pending);
          if (!firstSnapshot && !pending && m.uid !== user.uid) incoming(m);
        } else if (ch.type === 'modified') {
          const entry = rows.get(id);
          if (entry) {
            entry.m = m;
            entry.el.classList.toggle('pending', pending);
            renderReactions(entry);
          }
        } else if (ch.type === 'removed') {
          rows.get(id)?.el.remove();
          rows.delete(id);
        }
      });
      if (firstSnapshot) {
        firstSnapshot = false;
        scrollBottom();
      }
    },
    (err) => {
      console.error(err);
      toast(t('sendFailed'));
    }
  );

  window.addEventListener('focus', () => (document.title = t('appName')));
}

/* ---------- start ---------- */

async function boot() {
  document.title = t('appName');
  renderLoading();
  registerWorker();

  if (!configOk) return renderFatal(t('setupMissing'));

  try {
    user = await ensureUser();
    const snap = await getDoc(doc(db, 'members', user.uid));
    if (snap.exists()) {
      member = snap.data();
      showChat();
    } else {
      showJoin();
    }
  } catch (err) {
    console.error(err);
    const anonProblem =
      err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation';
    renderFatal(anonProblem ? t('anonOff') : t('joinFailed'), err.code || String(err.message || err));
  }
}

boot();