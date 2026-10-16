// ============================================================
//  HUD：全部用 DOM，文字清晰、排版好控制
// ============================================================

import { clamp, WEAPONS } from './config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      root: $('hud'),
      ch: $('crosshair'),
      chT: document.querySelector('#crosshair .t'),
      chB: document.querySelector('#crosshair .b'),
      chL: document.querySelector('#crosshair .l'),
      chR: document.querySelector('#crosshair .r'),
      hit: $('hitmark'),
      scope: $('scope-overlay'),
      dotsMe: $('dots-me'),
      dotsAi: $('dots-ai'),
      roundState: $('round-state'),
      roundTimer: $('round-timer'),
      banner: $('banner'),
      feed: $('feed'),
      hpFill: $('hp-fill'),
      hpNum: $('hp-num'),
      wpnName: $('wpn-name'),
      ammoMag: $('ammo-mag'),
      ammoRes: $('ammo-res'),
      reloadBar: document.querySelector('.reloadbar'),
      reloadFill: $('reload-fill'),
      dmg: $('dmgdir'),
      lowhp: $('lowhp'),
      wheel: $('wpn-wheel'),
    };
    this._dots = { me: [], ai: [] };
    this._bannerT = 0;
    this._hitT = 0;
    this._dmgT = 0;
    this._lastHP = 100;
  }

  show(on) { this.el.root.classList.toggle('hidden', !on); }

  buildDots(max) {
    for (const side of ['me', 'ai']) {
      const host = side === 'me' ? this.el.dotsMe : this.el.dotsAi;
      host.innerHTML = '';
      this._dots[side] = [];
      for (let i = 0; i < max; i++) {
        const d = document.createElement('i');
        if (side === 'ai') d.classList.add('ai');
        host.appendChild(d);
        this._dots[side].push(d);
      }
    }
  }

  setScore(me, ai) {
    this._dots.me.forEach((d, i) => d.classList.toggle('win', i < me));
    this._dots.ai.forEach((d, i) => d.classList.toggle('win', i < ai));
  }

  setRound(label, timer) {
    this.el.roundState.textContent = label;
    this.el.roundTimer.textContent = timer;
  }

  setHP(v, max) {
    const p = clamp(v / max, 0, 1);
    this.el.hpFill.style.width = (p * 100).toFixed(1) + '%';
    this.el.hpFill.classList.toggle('low', p < 0.35);
    this.el.hpNum.textContent = Math.max(0, Math.round(v));
    this.el.lowhp.style.opacity = p < 0.35 ? (0.35 - p) / 0.35 * 0.9 : 0;
    this._lastHP = v;
  }

  setWeapon(label) { this.el.wpnName.textContent = label; }

  setAmmo(mag, reserve) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoRes.textContent = reserve === Infinity ? '∞' : reserve;
    this.el.ammoMag.style.color = mag === 0 ? '#ff5c5c' : '';
  }

  setReload(t) {
    if (t <= 0) { this.el.reloadBar.classList.remove('on'); return; }
    this.el.reloadBar.classList.add('on');
    this.el.reloadFill.style.width = (clamp(t, 0, 1) * 100).toFixed(0) + '%';
  }

  /** spread 单位：度。换算成准心张开像素 */
  setCrosshair(spread, ads) {
    const px = clamp(6 + spread * 5.2, 5, 54);
    const s = px.toFixed(1) + 'px';
    this.el.chT.style.top = `-${px}px`;
    this.el.chB.style.top = `${px - 2}px`;
    this.el.chL.style.left = `-${px}px`;
    this.el.chR.style.left = `${px - 2}px`;
    this.el.ch.style.opacity = ads > 0.7 ? '0' : '1';
  }

  setScope(on) { this.el.scope.classList.toggle('on', on); }

  banner(text, dur = 1.6, small = false) {
    this.el.banner.textContent = text;
    this.el.banner.classList.toggle('small', small);
    this.el.banner.classList.add('on');
    this._bannerT = dur;
  }

  clearBanner() {
    this.el.banner.classList.remove('on');
    this._bannerT = 0;
  }

  feed(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.feed.appendChild(d);
    setTimeout(() => d.remove(), 3200);
    while (this.el.feed.children.length > 5) this.el.feed.firstChild.remove();
  }

  hitmark(kill) {
    this.el.hit.classList.add('on');
    this.el.hit.classList.toggle('kill', !!kill);
    this._hitT = kill ? 0.42 : 0.22;
  }

  damageDir(sx, sz, yaw) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const f = fx * sx + fz * sz;
    const r = rx * sx + rz * sz;
    const ang = Math.atan2(r, f) * 180 / Math.PI;
    let i = this.el.dmg.querySelector('i');
    if (!i) { i = document.createElement('i'); this.el.dmg.appendChild(i); }
    i.style.transform = `rotate(${ang.toFixed(1)}deg)`;
    i.style.opacity = '0.95';
    this._dmgT = 0.85;
  }

  buildWheel(currentId) {
    const host = this.el.wheel;
    host.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const d = document.createElement('div');
      d.textContent = `${i + 1} ${w.label.split(' ')[0]}`;
      if (w.id === currentId) d.classList.add('sel');
      host.appendChild(d);
    });
  }

  showWheel(on, currentId) {
    if (on) this.buildWheel(currentId);
    this.el.wheel.classList.toggle('on', on);
  }

  update(dt) {
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.el.banner.classList.remove('on');
    }
    if (this._hitT > 0) {
      this._hitT -= dt;
      if (this._hitT <= 0) this.el.hit.classList.remove('on');
    }
    if (this._dmgT > 0) {
      this._dmgT -= dt;
      if (this._dmgT <= 0) {
        const i = this.el.dmg.querySelector('i');
        if (i) i.style.opacity = '0';
      }
    }
  }

  reset() {
    this.el.feed.innerHTML = '';
    this.clearBanner();
    this.setScope(false);
    this.setReload(0);
    this._dmgT = 0;
    const i = this.el.dmg.querySelector('i');
    if (i) i.style.opacity = '0';
  }
}
