// ============================================================
//  输入：键盘鼠标（指针锁定）与触屏，统一成一份状态
// ============================================================

import { CFG, clamp } from './config.js';

export const MODE = { DESKTOP: 'desktop', MOBILE: 'mobile' };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = MODE.DESKTOP;

    // 移动轴（-1..1）
    this.moveX = 0;
    this.moveY = 0;
    // 视角增量（本帧累积，读完后清零）
    this.lookX = 0;
    this.lookY = 0;

    this.keys = new Set();
    this.mouseDown = [false, false, false];   // 左 中 右
    this.firing = false;
    this.aiming = false;
    this.sprint = false;
    this.wantJump = false;
    this.wantReload = false;
    this.wantSwapTo = -1;      // 数字键切枪
    this.wantSwapCycle = 0;    // 滚轮 / 触屏换枪

    this.locked = false;
    this.wantLock = false;
    this.onPause = null;
    this.sensitivity = 1.0;
    this.touchSensitivity = 1.0;
    this.invertY = false;

    this._stickId = null;
    this._lookId = null;
    this._stickOrigin = { x: 0, y: 0 };
    this._lookLast = { x: 0, y: 0 };
    this._touchButtons = new Map();

    this._bindDesktop();
    this._bindTouch();
  }

  // ---------------------------------------------------------- 桌面端
  _bindDesktop() {
    const c = this.canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { e.preventDefault(); return; }
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.wantReload = true;
      if (e.code === 'Space') this.wantJump = true;
      if (e.code === 'Escape') { if (this.onPause) this.onPause(); }
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) this.wantSwapTo = n - 1;
      }
      if (['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = [false,false,false]; });

    c.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      if (!this.locked && this.mode === MODE.DESKTOP) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022 * this.sensitivity;
      this.lookX += e.movementX * s;
      this.lookY += (this.invertY ? -e.movementY : e.movementY) * s;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) this.wantLock = false;
    });
    document.addEventListener('pointerlockerror', () => { this.wantLock = false; });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wantSwapCycle += e.deltaY > 0 ? 1 : -1;
    }, { passive: false });
  }

  requestLock() {
    if (this.mode !== MODE.DESKTOP) return;
    const c = this.canvas;
    if (document.pointerLockElement === c) { this.locked = true; return; }
    this.wantLock = true;
    // Chrome 在 exitPointerLock 后约 1 秒内会拒绝再次锁定，必须重试
    let tries = 0;
    const attempt = () => {
      if (!this.wantLock || document.pointerLockElement === c) return;
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {});
      tries++;
      if (tries < 6 && this.wantLock) setTimeout(attempt, 260);
    };
    attempt();
  }

  releaseLock() {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.locked = false;
  }

  // ---------------------------------------------------------- 触屏
  _bindTouch() {
    const stickZone = document.getElementById('stick-zone');
    const stickBase = document.getElementById('stick-base');
    const stickKnob = document.getElementById('stick-knob');
    const R = 52;

    const onStart = (e) => {
      for (const t of e.changedTouches) {
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const btn = el && el.closest ? el.closest('.tbtn') : null;
        if (btn) {
          this._touchButtons.set(t.identifier, btn.id);
          btn.classList.add('on');
          this._pressButton(btn.id, true);
          continue;
        }
        if (this._stickId === null && t.clientX < window.innerWidth * 0.5) {
          this._stickId = t.identifier;
          this._stickOrigin = { x: t.clientX, y: t.clientY };
          stickBase.style.left = t.clientX + 'px';
          stickBase.style.top = t.clientY + 'px';
          stickBase.classList.add('on');
          stickKnob.style.transform = 'translate(-50%,-50%)';
        } else if (this._lookId === null) {
          this._lookId = t.identifier;
          this._lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    };

    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stickId) {
          let dx = t.clientX - this._stickOrigin.x;
          let dy = t.clientY - this._stickOrigin.y;
          const d = Math.hypot(dx, dy);
          const k = d > R ? R / d : 1;
          dx *= k; dy *= k;
          stickKnob.style.transform =
            `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
          this.moveX = clamp(dx / R, -1, 1);
          this.moveY = clamp(dy / R, -1, 1);
          this.sprint = d > R * 0.92;
        } else if (t.identifier === this._lookId) {
          const s = 0.0034 * this.touchSensitivity;
          this.lookX += (t.clientX - this._lookLast.x) * s;
          this.lookY += (this.invertY ? -1 : 1) * (t.clientY - this._lookLast.y) * s;
          this._lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    };

    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._stickId) {
          this._stickId = null;
          this.moveX = this.moveY = 0;
          this.sprint = false;
          stickBase.classList.remove('on');
        } else if (t.identifier === this._lookId) {
          this._lookId = null;
        }
        const bid = this._touchButtons.get(t.identifier);
        if (bid) {
          this._touchButtons.delete(t.identifier);
          const el = document.getElementById(bid);
          if (el) el.classList.remove('on');
          this._pressButton(bid, false);
        }
      }
      e.preventDefault();
    };

    const opts = { passive: false };
    window.addEventListener('touchstart', onStart, opts);
    window.addEventListener('touchmove', onMove, opts);
    window.addEventListener('touchend', onEnd, opts);
    window.addEventListener('touchcancel', onEnd, opts);
  }

  _pressButton(id, down) {
    switch (id) {
      case 'btn-fire': this.firing = down; break;
      case 'btn-ads': this.aiming = down; break;
      case 'btn-jump': if (down) this.wantJump = true; break;
      case 'btn-reload': if (down) this.wantReload = true; break;
      case 'btn-swap': if (down) this.wantSwapCycle += 1; break;
      case 'btn-pause': if (down && this.onPause) this.onPause(); break;
      default: break;
    }
  }

  // ---------------------------------------------------------- 每帧刷新
  update() {
    if (this.mode === MODE.DESKTOP) {
      let x = 0, y = 0;
      if (this.keys.has('KeyW')) y -= 1;
      if (this.keys.has('KeyS')) y += 1;
      if (this.keys.has('KeyA')) x -= 1;
      if (this.keys.has('KeyD')) x += 1;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      this.moveX = x;
      this.moveY = y;
      this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      this.firing = this.mouseDown[0];
      this.aiming = this.mouseDown[2];
      // 桌面端没有换枪按钮，用滚轮/数字键；这里把 cycle 折算掉
    }
    // 触屏的 moveX/moveY 由事件直接维护
  }

  // 取走本帧的视角增量
  consumeLook() {
    const l = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return l;
  }

  consumeJump() { const j = this.wantJump; this.wantJump = false; return j; }
  consumeReload() { const r = this.wantReload; this.wantReload = false; return r; }
  consumeSwapTo() { const s = this.wantSwapTo; this.wantSwapTo = -1; return s; }
  consumeSwapCycle() { const s = this.wantSwapCycle; this.wantSwapCycle = 0; return s; }

  reset() {
    this.keys.clear();
    this.mouseDown = [false, false, false];
    this.moveX = this.moveY = 0;
    this.lookX = this.lookY = 0;
    this.firing = this.aiming = this.sprint = false;
    this.wantJump = this.wantReload = false;
    this.wantSwapTo = -1;
    this.wantSwapCycle = 0;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === MODE.MOBILE) this.releaseLock();
  }
}
