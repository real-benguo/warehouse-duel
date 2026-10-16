// ============================================================
//  入口：加载 → 选设备端 → 主菜单 → 对战
// ============================================================

import { CFG, WEAPONS } from './config.js';
import { Game } from './game.js';
import { HUD } from './hud.js';
import { Input, MODE } from './input.js';
import * as SFX from './audio.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ 画质
function detectQuality(level) {
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)
    || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  let auto = isMobile ? 'mid' : 'high';
  if (cores <= 4 || mem <= 2) auto = isMobile ? 'low' : 'mid';
  const lv = level === 'auto' ? auto : level;

  const base = {
    low:  { shadows: false, pixelRatio: 1.0, pointLights: 2, fog: true, antialias: false },
    mid:  { shadows: false, pixelRatio: 1.35, pointLights: 3, fog: true, antialias: true },
    high: { shadows: true,  pixelRatio: 1.6, pointLights: 4, fog: true, antialias: true },
  }[lv] || { shadows: false, pixelRatio: 1.3, pointLights: 3, fog: true, antialias: true };

  return { level: lv, isMobile, ...base, maxEnemies: 1 };
}

// ------------------------------------------------------------ 状态
let game = null;
let hud = null;
let input = null;
let quality = null;
let mode = MODE.DESKTOP;
let chosen = false;
let loaded = false;

const LS = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};

function showScreen(id) {
  ['scr-load', 'scr-pick', 'scr-menu', 'scr-arsenal', 'scr-help', 'scr-pause', 'scr-over']
    .forEach((s) => $(s).classList.toggle('show', s === id));
  if (!id) {
    ['scr-load', 'scr-pick', 'scr-menu', 'scr-arsenal', 'scr-help', 'scr-pause', 'scr-over']
      .forEach((s) => $(s).classList.remove('show'));
  }
}

function fatal(msg) {
  const el = $('fatal');
  el.textContent = '出错了：\n\n' + msg + '\n\n把这段发给我，我来修。';
  el.classList.add('on');
}

// ------------------------------------------------------------ 画质菜单
let qLevel = LS.get('wd_quality', 'auto');
function refreshQLabel() {
  const map = { auto: '自动', high: '高', mid: '中', low: '低' };
  $('q-label').textContent = map[qLevel] || '自动';
}
function cycleQuality() {
  const order = ['auto', 'high', 'mid', 'low'];
  qLevel = order[(order.indexOf(qLevel) + 1) % order.length];
  LS.set('wd_quality', qLevel);
  refreshQLabel();
  SFX.uiBeep(760);
  if (game) {
    const q = detectQuality(qLevel);
    game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    game.renderer.shadowMap.enabled = !!q.shadows;
    if (game.world.sunLight) game.world.sunLight.castShadow = !!q.shadows;
    if (game.world.ambient) game.world.ambient.intensity = q.shadows ? 0.85 : 1.15;
    game.world.scene.fog = q.fog ? game.world.scene.fog : null;
  }
}

// ------------------------------------------------------------ 武器库 / 说明
function buildArsenal() {
  const host = $('arsenal-list');
  host.innerHTML = '';
  for (const w of WEAPONS) {
    const d = document.createElement('div');
    d.className = 'wcard';
    const dps = (w.dmg * w.pellets * w.rpm / 60).toFixed(0);
    d.innerHTML = `
      <div class="wname">${w.label}</div>
      <div class="wtag">${w.tag}</div>
      <div class="wrow"><span>单发伤害</span><b>${w.dmg}${w.pellets > 1 ? ' ×' + w.pellets : ''}</b></div>
      <div class="wrow"><span>射速</span><b>${w.rpm} 发/分</b></div>
      <div class="wrow"><span>弹匣</span><b>${w.mag} 发</b></div>
      <div class="wrow"><span>换弹</span><b>${w.reload.toFixed(2)} 秒</b></div>
      <div class="wrow"><span>爆头倍率</span><b>×${w.headMul}</b></div>
      <div class="wrow"><span>理论 DPS</span><b>${dps}</b></div>
      <div class="wrow"><span>开镜视野</span><b>${w.adsFov}°</b></div>
      <div class="wrow"><span>移动速度</span><b>${(w.moveMul * 100).toFixed(0)}%</b></div>`;
    host.appendChild(d);
  }
}

function buildHelp() {
  const rows = mode === MODE.DESKTOP ? [
    ['W A S D', '移动'],
    ['鼠标移动', '转视角'],
    ['鼠标左键', '开火'],
    ['鼠标右键', '开镜'],
    ['Shift', '疾跑'],
    ['空格', '跳跃'],
    ['R', '换弹'],
    ['1 ~ 6', '切换武器'],
    ['鼠标滚轮', '循环换枪'],
    ['Esc', '暂停'],
    ['', ''],
    ['规则', '每人 100 血，先赢 5 回合获胜'],
    ['提示', '开镜能大幅减小散布，但会变慢'],
    ['提示', '按住左键自动武器会连发'],
  ] : [
    ['左半屏摇杆', '移动'],
    ['右半屏拖动', '转视角'],
    ['右下大按钮', '开火'],
    ['开镜按钮', '开镜（狙击枪进瞄准镜）'],
    ['换弹按钮', '换弹'],
    ['换枪按钮', '循环换武器'],
    ['跳按钮', '跳跃'],
    ['右上 II', '暂停'],
    ['', ''],
    ['规则', '每人 100 血，先赢 5 回合获胜'],
    ['提示', '推荐横屏，双手握持更稳'],
    ['提示', '把摇杆推到最外圈会自动疾跑'],
  ];
  const host = $('help-body');
  host.innerHTML = rows.map(([k, v]) =>
    `<div class="hk">${k}</div><div class="hv">${v}</div>`).join('');
}

// ------------------------------------------------------------ 启动
async function boot() {
  quality = detectQuality(qLevel);
  refreshQLabel();

  const canvas = $('gl');
  input = new Input(canvas);
  hud = new HUD();

  showScreen('scr-load');
  const bar = $('load-bar');
  const txt = $('load-txt');

  try {
    game = new Game({ canvas, quality, input, hud, mode });
    await game.init((p, label) => {
      bar.style.width = (p * 100).toFixed(0) + '%';
      if (label) txt.textContent = label + ' …';
    });
  } catch (e) {
    fatal((e && e.stack) || (e && e.message) || String(e));
    return;
  }

  loaded = true;

  // 调试钩子（方便在浏览器控制台里手动调参数，也供自动化测试使用）
  window.__WD = {
    get game() { return game; },
    get hud() { return hud; },
    get input() { return input; },
    CFG, WEAPONS,
    setMode(m) { mode = m; chosen = true; applyMode(); showScreen(null); },
    screens: {
      pick: () => showScreen('scr-pick'),
      menu: () => showScreen('scr-menu'),
      none: () => showScreen(null),
    },
  };

  game.onMatchEnd = (win, me, ai) => {
    $('over-title').textContent = win ? '胜 利' : '失 败';
    $('over-sub').textContent = `比分 ${me} : ${ai}`;
    setTimeout(() => { game.stop(); hud.show(false); showScreen('scr-over'); }, 1400);
  };

  input.onPause = () => {
    if (!game.running) return;
    if (game.paused) { game.resume(); showScreen(null); hud.show(true); }
    else { game.pause(); hud.show(false); showScreen('scr-pause'); }
  };

  // 推荐设备端
  const recommend = quality.isMobile ? MODE.MOBILE : MODE.DESKTOP;
  $('tag-' + recommend).textContent = '推荐';
  $('tag-' + recommend).classList.add('on');

  showScreen('scr-pick');
}

// ------------------------------------------------------------ 选端
document.querySelectorAll('.pick').forEach((btn) => {
  btn.addEventListener('click', () => {
    SFX.resumeAudio();
    SFX.uiBeep(880);
    mode = btn.dataset.mode;
    chosen = true;
    applyMode();
    showScreen('scr-menu');
  });
});

function applyMode() {
  input.setMode(mode);
  const isMobile = mode === MODE.MOBILE;
  document.body.classList.toggle('mobile', isMobile);
  $('touch').classList.toggle('hidden', !isMobile);
  $('m-label').textContent = isMobile ? '手机端' : '电脑端';
  $('menu-hint').textContent = isMobile
    ? '对手：AI 机器人 · 横屏双手握持'
    : '对手：AI 机器人 · 点一下画面锁定鼠标';
  buildHelp();
  checkOrientation();
}

// ------------------------------------------------------------ 菜单
document.querySelectorAll('#menu-list .mi').forEach((btn) => {
  btn.addEventListener('click', () => {
    SFX.resumeAudio();
    const act = btn.dataset.act;
    if (act === 'play') startPlay();
    else if (act === 'arsenal') { buildArsenal(); showScreen('scr-arsenal'); }
    else if (act === 'help') { buildHelp(); showScreen('scr-help'); }
    else if (act === 'quality') cycleQuality();
    else if (act === 'switch') { showScreen('scr-pick'); }
    SFX.uiBeep(820);
  });
});

document.querySelectorAll('[data-back]').forEach((b) =>
  b.addEventListener('click', () => { SFX.uiBeep(680); showScreen('scr-menu'); }));

document.querySelectorAll('#scr-pause .mi, #scr-over .mi').forEach((btn) => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    SFX.uiBeep(820);
    if (act === 'resume') { game.resume(); hud.show(true); showScreen(null); }
    else if (act === 'restart') { showScreen(null); hud.show(true); game.startMatch(); }
    else if (act === 'quit') { game.stop(); hud.show(false); showScreen('scr-menu'); }
  });
});

async function startPlay() {
  showScreen(null);
  hud.show(true);
  if (mode === MODE.MOBILE) {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) { /* 用户拒绝就算了 */ }
  }
  game.startMatch();
}

// ------------------------------------------------------------ 横屏提醒
function checkOrientation() {
  const need = mode === MODE.MOBILE && window.innerHeight > window.innerWidth;
  $('rotate-warn').classList.toggle('on', need && game && game.running);
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 250));

// 阻止移动端双击缩放 / 长按选择
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// 未捕获错误直接显示出来，别白屏
window.addEventListener('error', (e) => {
  if (!loaded) fatal((e.error && e.error.stack) || e.message || '未知错误');
});
window.addEventListener('unhandledrejection', (e) => {
  if (!loaded) fatal((e.reason && (e.reason.stack || e.reason.message)) || '未知错误');
});

boot();
