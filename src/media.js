// Photos and voice notes are stored inside Firestore documents (no Firebase Storage / billing needed),
// so they are kept small: photos are shrunk, voice notes are capped at MAX_VOICE_SEC at a low bitrate.

export const MAX_VOICE_SEC = 60;
const MAX_DATA_CHARS = 900_000; // Firestore documents are limited to 1 MiB

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function loadSource(file) {
  if (window.createImageBitmap) {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: b, width: b.width, height: b.height, close: () => b.close() };
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    return { src: img, width: img.naturalWidth, height: img.naturalHeight, close() {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(file, maxSide = 900, maxChars = 420_000) {
  const source = await loadSource(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    let w = Math.max(1, Math.round(source.width * scale));
    let h = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let quality = 0.72;
    let out = '';
    for (let i = 0; i < 8; i++) {
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(source.src, 0, 0, w, h);
      out = canvas.toDataURL('image/jpeg', quality);
      if (out.length <= maxChars) break;
      quality -= 0.1;
      if (quality < 0.4) {
        quality = 0.6;
        w = Math.round(w * 0.8);
        h = Math.round(h * 0.8);
      }
    }
    if (out.length > MAX_DATA_CHARS) throw new Error('image too large');
    return out;
  } finally {
    source.close();
  }
}

function pickMime() {
  if (!window.MediaRecorder) return '';
  const options = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export async function startRecording({ maxSec = MAX_VOICE_SEC, onTick, onLimit } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    const err = new Error('unsupported');
    err.code = 'unsupported';
    throw err;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    audioBitsPerSecond: 24000,
  });

  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  const startedAt = Date.now();
  let cancelled = false;
  let timer = null;
  let finish;
  const done = new Promise((resolve) => (finish = resolve));

  rec.onstop = () => {
    clearInterval(timer);
    stream.getTracks().forEach((tr) => tr.stop());
    if (cancelled) return finish(null);
    const type = rec.mimeType || mime || 'audio/webm';
    finish({
      blob: new Blob(chunks, { type }),
      dur: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      seconds: (Date.now() - startedAt) / 1000,
    });
  };

  rec.start();
  timer = setInterval(() => {
    const s = (Date.now() - startedAt) / 1000;
    onTick?.(s);
    if (s >= maxSec) {
      clearInterval(timer);
      onLimit?.();
    }
  }, 250);

  return {
    stop() {
      if (rec.state !== 'inactive') rec.stop();
      return done;
    },
    cancel() {
      cancelled = true;
      if (rec.state !== 'inactive') rec.stop();
    },
  };
}

export const voiceTooBig = (dataUrl) => dataUrl.length > MAX_DATA_CHARS;
