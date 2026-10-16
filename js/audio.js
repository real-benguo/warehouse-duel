// ============================================================
//  音效：全部用 WebAudio 现场合成，不加载任何音频文件
//  AudioContext 必须在第一次用户手势里创建，否则会被浏览器挂起
// ============================================================

import { clamp } from './config.js';

let ctx = null;
let masterGain = null;
let sfxGain = null;
let noiseBuf = null;
let ready = false;

export function initAudio() {
  if (ready) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.85;
    masterGain.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.75;
    sfxGain.connect(masterGain);
    // 预生成 1.2s 白噪声
    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    ready = true;
  } catch (e) {
    ready = false;
  }
  return ready;
}

export function resumeAudio() {
  if (!ready) initAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  if (masterGain) masterGain.gain.value = clamp(v, 0, 1);
}

export function isAudioReady() { return ready; }

function now() { return ctx ? ctx.currentTime : 0; }

// 立体声定位：pan -1 左 / +1 右
function panner(pan) {
  if (!ctx.createStereoPanner) return null;
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan || 0, -1, 1);
  return p;
}

function chain(nodes, pan, gainVal) {
  const p = panner(pan);
  const g = ctx.createGain();
  g.gain.value = gainVal;
  let head = nodes[0];
  for (let i = 1; i < nodes.length; i++) head.connect(nodes[i]), (head = nodes[i]);
  if (p) { head.connect(p); head = p; }
  head.connect(g);
  g.connect(sfxGain);
  return { tail: head, gain: g };
}

// ---------- 噪声爆发（枪声 / 脚步 / 爆炸） ----------
function noiseBurst({ dur = 0.16, gain = 0.5, f0 = 5200, f1 = 260, q = 0.9,
                      type = 'lowpass', pan = 0, delay = 0, attack = 0.001 }) {
  if (!ready) return;
  const t = now() + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt); flt.connect(g);
  const p = panner(pan);
  if (p) { g.connect(p); p.connect(sfxGain); } else g.connect(sfxGain);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ---------- 音调 ----------
function tone({ f0 = 440, f1 = 220, dur = 0.12, gain = 0.3, type = 'sine',
                pan = 0, delay = 0 }) {
  if (!ready) return;
  const t = now() + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  const p = panner(pan);
  if (p) { g.connect(p); p.connect(sfxGain); } else g.connect(sfxGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// ============================================================ 具体音效

const GUN_PRESETS = {
  rifle:   { dur: 0.15, gain: 0.42, f0: 6200, f1: 300, body: 165, bodyGain: 0.30 },
  smg:     { dur: 0.10, gain: 0.30, f0: 7200, f1: 420, body: 210, bodyGain: 0.20 },
  shotgun: { dur: 0.30, gain: 0.60, f0: 4200, f1: 130, body: 110, bodyGain: 0.46 },
  sniper:  { dur: 0.42, gain: 0.66, f0: 5200, f1: 95,  body: 88,  bodyGain: 0.52 },
  pistol:  { dur: 0.11, gain: 0.34, f0: 6600, f1: 380, body: 190, bodyGain: 0.22 },
  lmg:     { dur: 0.17, gain: 0.46, f0: 5600, f1: 250, body: 140, bodyGain: 0.34 },
};

export function gunshot(kind = 'rifle', pan = 0) {
  const p = GUN_PRESETS[kind] || GUN_PRESETS.rifle;
  noiseBurst({ dur: p.dur, gain: p.gain, f0: p.f0, f1: p.f1, q: 1.1, pan });
  tone({ f0: p.body, f1: p.body * 0.42, dur: p.dur * 1.15, gain: p.bodyGain,
         type: 'triangle', pan });
  // 远处回音
  noiseBurst({ dur: p.dur * 2.6, gain: p.gain * 0.16, f0: 1400, f1: 220,
               q: 0.6, pan, delay: 0.055 });
}

export function dryFire() {
  tone({ f0: 1900, f1: 900, dur: 0.045, gain: 0.14, type: 'square' });
}

export function reloadClick(stage = 0) {
  const base = [0.0, 0.10, 0.24][stage] || 0;
  noiseBurst({ dur: 0.05, gain: 0.24, f0: 3400, f1: 900, q: 2.2, delay: base });
  tone({ f0: 620, f1: 380, dur: 0.05, gain: 0.10, type: 'square', delay: base });
}

export function reloadDone() {
  noiseBurst({ dur: 0.07, gain: 0.30, f0: 4200, f1: 800, q: 2.0 });
  tone({ f0: 900, f1: 520, dur: 0.08, gain: 0.14, type: 'square', delay: 0.02 });
}

export function footstep(pan = 0, loud = 1) {
  noiseBurst({ dur: 0.075, gain: 0.085 * loud, f0: 1500, f1: 240, q: 0.8, pan });
  tone({ f0: 130, f1: 78, dur: 0.075, gain: 0.06 * loud, type: 'triangle', pan });
}

export function jumpLand(pan = 0) {
  noiseBurst({ dur: 0.14, gain: 0.20, f0: 900, f1: 140, q: 0.7, pan });
}

export function hitmark(head = false) {
  tone({ f0: head ? 2100 : 1500, f1: head ? 1400 : 1000, dur: 0.055,
         gain: head ? 0.22 : 0.16, type: 'square' });
}

export function hurt(pan = 0) {
  noiseBurst({ dur: 0.20, gain: 0.34, f0: 700, f1: 110, q: 0.6, pan });
  tone({ f0: 190, f1: 90, dur: 0.22, gain: 0.20, type: 'sawtooth', pan });
}

export function enemyDown(pan = 0) {
  tone({ f0: 420, f1: 70, dur: 0.55, gain: 0.24, type: 'sawtooth', pan });
  noiseBurst({ dur: 0.35, gain: 0.20, f0: 1200, f1: 120, q: 0.7, pan, delay: 0.05 });
}

export function uiBeep(f = 900, dur = 0.07, g = 0.13) {
  tone({ f0: f, f1: f * 0.9, dur, gain: g, type: 'square' });
}

export function countdownBeep(final = false) {
  tone({ f0: final ? 1250 : 720, f1: final ? 1250 : 700,
         dur: final ? 0.30 : 0.10, gain: final ? 0.24 : 0.16, type: 'square' });
}

export function roundWin() {
  [660, 880, 1180].forEach((f, i) =>
    tone({ f0: f, f1: f, dur: 0.20, gain: 0.16, type: 'triangle', delay: i * 0.10 }));
}

export function roundLose() {
  [520, 400, 290].forEach((f, i) =>
    tone({ f0: f, f1: f * 0.9, dur: 0.28, gain: 0.16, type: 'sawtooth', delay: i * 0.12 }));
}

export function bulletImpact(pan = 0) {
  noiseBurst({ dur: 0.055, gain: 0.13, f0: 5200, f1: 900, q: 2.6, pan });
}

export function ricochet(pan = 0) {
  tone({ f0: 2400, f1: 700, dur: 0.10, gain: 0.10, type: 'square', pan });
}
