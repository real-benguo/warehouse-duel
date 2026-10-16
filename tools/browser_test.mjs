// ============================================================
//  浏览器实测：加载页面 → 抓控制台报错 → 截各界面图
//  用法: node tools/browser_test.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// playwright-core 装在隔离的 node 工作区里，用绝对路径动态载入
const PW = process.env.PW_PATH ||
  'C:/Users/ben19/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const _pw = await import(pathToFileURL(PW).href);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
if (!chromium) throw new Error('playwright-core 载入失败');

const URL = process.env.WD_URL || 'http://127.0.0.1:8777/';
const OUT = path.resolve('tools/shots');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const logs = [];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--hide-scrollbars',
    '--mute-audio',
  ],
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

page.on('console', (m) => {
  const t = m.type();
  const text = `[${t}] ${m.text()}`;
  logs.push(text);
  if (t === 'error') errors.push(text);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)));
page.on('requestfailed', (r) =>
  errors.push('[requestfailed] ' + r.url() + ' :: ' + (r.failure()?.errorText || '')));

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('SHOT', name);
};

const step = async (label, fn) => {
  process.stdout.write('→ ' + label + ' ... ');
  try { await fn(); console.log('ok'); }
  catch (e) { console.log('FAIL: ' + e.message); errors.push('[step:' + label + '] ' + e.message); }
};

await step('打开页面', async () => {
  await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
});

await step('等待加载完成（选端界面出现）', async () => {
  await page.waitForSelector('#scr-pick.show', { timeout: 40000 });
  await page.waitForTimeout(400);
});
await step('截图: 选端界面', () => shot('01_pick'));

await step('点击「电脑端」', async () => {
  await page.click('.pick[data-mode="desktop"]');
  await page.waitForSelector('#scr-menu.show', { timeout: 8000 });
  await page.waitForTimeout(300);
});
await step('截图: 主菜单', () => shot('02_menu'));

await step('打开武器库', async () => {
  await page.click('#menu-list .mi[data-act="arsenal"]');
  await page.waitForSelector('#scr-arsenal.show', { timeout: 5000 });
  await page.waitForTimeout(250);
});
await step('截图: 武器库', () => shot('03_arsenal'));
await step('返回菜单', async () => {
  await page.click('#scr-arsenal .back');
  await page.waitForTimeout(250);
});

await step('打开操作说明', async () => {
  await page.click('#menu-list .mi[data-act="help"]');
  await page.waitForSelector('#scr-help.show', { timeout: 5000 });
  await page.waitForTimeout(250);
});
await step('截图: 操作说明', () => shot('04_help'));
await step('返回菜单', async () => {
  await page.click('#scr-help .back');
  await page.waitForTimeout(250);
});

await step('开始对战', async () => {
  await page.click('#menu-list .mi[data-act="play"]');
  await page.waitForTimeout(1200);
});
await step('截图: 倒计时', () => shot('05_countdown'));

await step('等回合开始', async () => {
  await page.waitForFunction(() => window.__WD && window.__WD.game.round.state === 'live',
    { timeout: 12000 });
  await page.waitForTimeout(600);
});
await step('截图: 开局（出生点）', () => shot('06_spawn'));

// ---- 逐个武器截图（含开镜） ----
const guns = ['assault', 'smg', 'shotgun', 'sniper', 'pistol', 'lmg'];
for (const g of guns) {
  await step(`切到 ${g} 并截图`, async () => {
    await page.evaluate((id) => {
      const G = window.__WD.game;
      G.round.state = 'live';
      G.player.alive = true;
      const i = window.__WD.WEAPONS.findIndex((w) => w.id === id);
      G.weapons.select(i, true);
      G.weapons.ads = 0;
    }, g);
    await page.waitForTimeout(450);
    await shot('10_gun_' + g);
  });
  await step(`${g} 开镜截图`, async () => {
    await page.evaluate(() => {
      const G = window.__WD.game;
      G.round.state = 'live';
      G.player.alive = true;
      G.input.mouseDown[2] = true;   // input.update() 每帧会重算 aiming，必须改底层状态
      G.weapons.adsTarget = 1;
      G.weapons.ads = 1;
    });
    await page.waitForTimeout(500);
    await shot('11_ads_' + g);
    await page.evaluate(() => {
      const G = window.__WD.game;
      G.input.mouseDown[2] = false;
      G.weapons.adsTarget = 0;
      G.weapons.ads = 0;
    });
    await page.waitForTimeout(200);
  });
}

// ---- 走到场地中央，看敌人 ----
await step('移到场地中央看敌人', async () => {
  await page.evaluate(() => {
    const G = window.__WD.game;
    G.round.state = 'live';
    G.player.hp = 100; G.player.alive = true;
    G.weapons.select(0, true);
    G.player.pos.set(-5.0, 0, -9.5);
    G.player.yaw = -Math.PI / 2;   // 朝 +X
    G.player.pitch = 0;
    const e = G.opponent.enemy;
    e.spawn(new (e.pos.constructor)(5.0, 0, -9.5), Math.PI / 2, 'assault');
    e.state = 'engage';
  });
  await page.waitForTimeout(700);
});
await step('截图: 看到敌人', () => shot('20_enemy_visible'));

await step('打一枪（命中反馈）', async () => {
  await page.evaluate(() => {
    const G = window.__WD.game;
    const V = G.player.pos.constructor;
    G.round.state = 'live';
    // 把敌人钉死在原点，相机放到 8 米外正对它，然后同一帧内开火
    const e = G.opponent.enemy;
    e.spawn(new V(0, 0, -9.5), Math.PI / 2, 'assault');
    e.state = 'idle';
    e.vel.set(0, 0, 0);
    G.player.pos.set(5, 0, -9.5);
    G.player.yaw = Math.PI / 2;   // forward = -X
    G.player.pitch = 0;
    G.camera.position.set(5, 1.62, -9.5);
    G.camera.rotation.set(0, Math.PI / 2, 0);
    G.camera.updateMatrixWorld(true);

    window.__WD.__hpBefore = e.hp;
    window.__WD.__rayHit = G.opponent.rayHit(new V(5, 1.62, -9.5), new V(-1, 0, 0), 100);
    window.__WD.__worldHit = G.world.raycast(new V(5, 1.62, -9.5), new V(-1, 0, 0), 100);
    G.weapons.cooldown = 0;
    G.weapons.ammo[G.weapons.current.id].mag = 30;
    G._onPlayerShot(G.weapons.current, [new V(-1, 0, 0)], 0);
    window.__WD.__hpAfter = e.hp;
  });
  await page.waitForTimeout(120);
});
await step('检查伤害是否生效', async () => {
  const r = await page.evaluate(() => ({
    before: window.__WD.__hpBefore, after: window.__WD.__hpAfter,
    ray: window.__WD.__rayHit,
    world: window.__WD.__worldHit ? window.__WD.__worldHit.t : null,
    alive: window.__WD.game.opponent.isAlive(),
  }));
  console.log('   rayHit =', JSON.stringify(r.ray), ' worldHitT =', r.world);
  console.log('   HP', r.before, '->', r.after, 'alive=', r.alive);
  if (r.after >= r.before) errors.push('[logic] 开枪没有造成伤害: ' + JSON.stringify(r));
});
await step('截图: 命中', () => shot('21_hit'));

// ---- 让敌人打玩家，检查掉血 ----
await step('让 AI 开火并检查玩家掉血', async () => {
  const r = await page.evaluate(async () => {
    const G = window.__WD.game;
    G.round.state = 'live';
    G.player.hp = 100;
    G.player.alive = true;
    const e = G.opponent.enemy;
    e.pos.set(0.0, 0, 0.0);
    G.player.pos.set(0.0, 0, -6.0);
    for (let i = 0; i < 12; i++) {
      G._onBotShot({ origin: e.eye(new (e.pos.constructor)()),
        dir: new (e.pos.constructor)(0, 0, -1), dmg: 9, pellets: 1,
        sfx: 'rifle', from: e.pos.clone() });
    }
    return G.player.hp;
  });
  console.log('   玩家 HP =', r);
  if (r >= 100) errors.push('[logic] AI 开枪没有让玩家掉血');
});
await step('截图: 受伤', () => shot('22_damage'));

// ---- 40 秒实战冒烟：让 AI 自己打，看回合流程和 AI 行为 ----
await step('40 秒实战冒烟（AI 自主对战）', async () => {
  await page.evaluate(() => {
    const G = window.__WD.game;
    window.__WD.CFG.round.scoreToWin = 99;   // 别让对局提前结束，跑满 40 秒
    const log = { rounds: 0, aiShots: 0, aiMaxDist: 0 };
    window.__WD.__log = log;
    const spawnB = G.world.spawns[1].pos.clone();
    window.__WD.__spawnB = spawnB;
    const origBot = G._onBotShot.bind(G);
    G._onBotShot = (sh) => { log.aiShots++; return origBot(sh); };
    const origEnd = G._endRound.bind(G);
    G._endRound = (w, r) => { log.rounds++; return origEnd(w, r); };
    G.startMatch();
    G.input.mouseDown[0] = true;            // 玩家一直开火
    window.__WD.__t1 = setInterval(() => {
      G.input.lookX += (Math.random() - 0.5) * 0.12;
      G.input.keys.clear();
      G.input.keys.add(Math.random() < 0.5 ? 'KeyW' : 'KeyS');
      G.input.keys.add(Math.random() < 0.5 ? 'KeyA' : 'KeyD');
      const d = G.opponent.enemy.pos.distanceTo(window.__WD.__spawnB);
      if (d > log.aiMaxDist) log.aiMaxDist = d;
    }, 200);
  });
  await page.waitForTimeout(42000);
  const r = await page.evaluate(() => {
    const G = window.__WD.game;
    clearInterval(window.__WD.__t1);
    G.input.mouseDown[0] = false;
    G.input.keys.clear();
    return {
      ...window.__WD.__log,
      score: [G.round.me, G.round.ai],
      roundNo: G.round.no,
      state: G.round.state,
      aiMoved: +window.__WD.__log.aiMaxDist.toFixed(2),
      playerHP: Math.round(G.player.hp),
      fps: +G.fps.toFixed(1),
    };
  });
  console.log('   ', JSON.stringify(r));
  if (r.rounds < 1) errors.push('[logic] 40 秒内一个回合都没结束，回合流程可能卡住');
  if (r.aiShots < 5) errors.push('[logic] AI 40 秒只开了 ' + r.aiShots + ' 枪，AI 可能没在打');
  if (r.aiMoved < 1.0) errors.push('[logic] AI 位移只有 ' + r.aiMoved + ' m，可能卡住了');
});
await step('截图: 实战中', () => shot('23_soak'));

// ---- 触屏模式界面 ----
await step('切到手机端并截图 HUD', async () => {
  await page.evaluate(() => {
    window.__WD.CFG.round.scoreToWin = 5;      // 恢复真实比分（冒烟测试里改成 99 了）
    window.__WD.game.hud.buildDots(5);
    window.__WD.game.hud.setScore(1, 2);
    window.__WD.setMode('mobile');
  });
  await page.waitForTimeout(400);
});
await step('截图: 手机端', () => shot('30_mobile'));

await step('手机端 HUD 排版自检', async () => {
  const r = await page.evaluate(() => {
    const ids = ['hp-num', 'ammo-mag', 'wpn-name', 'btn-fire', 'btn-ads',
                 'btn-reload', 'btn-jump', 'btn-swap', 'btn-pause'];
    const out = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) { out[id] = null; continue; }
      const b = e.getBoundingClientRect();
      out[id] = [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)];
    }
    return { vw: innerWidth, vh: innerHeight, bodyClass: document.body.className, out };
  });
  console.log('    视口', r.vw + 'x' + r.vh, 'body="' + r.bodyClass + '"');
  for (const [k, v] of Object.entries(r.out)) console.log('    ', k.padEnd(12), v ? v.join(',') : 'MISSING');
  const names = Object.keys(r.out).filter((k) => r.out[k]);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = r.out[names[i]], b = r.out[names[j]];
      const ov = !(a[2] <= b[0] + 2 || b[2] <= a[0] + 2 || a[3] <= b[1] + 2 || b[3] <= a[1] + 2);
      if (ov) errors.push('[layout] 手机端 ' + names[i] + ' 和 ' + names[j] + ' 重叠');
    }
  }
  for (const [k, v] of Object.entries(r.out)) {
    if (!v) { errors.push('[layout] 手机端找不到元素 ' + k); continue; }
    if (v[0] < -2 || v[1] < -2 || v[2] > r.vw + 2 || v[3] > r.vh + 2) {
      errors.push('[layout] 手机端 ' + k + ' 超出屏幕: ' + v.join(','));
    }
  }
});

await step('手机端竖屏提醒', async () => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(600);
});
await step('截图: 手机竖屏', () => shot('31_mobile_portrait'));

// ---- 性能 ----
await step('采集帧率', async () => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.evaluate(() => { window.__WD.setMode('desktop'); });
  await page.waitForTimeout(2500);
  const fps = await page.evaluate(() => window.__WD.game.fps);
  console.log('   FPS(软件渲染) =', fps.toFixed(1));
});

// ---- 输出 ----
console.log('\n================ 控制台 ================');
logs.slice(-40).forEach((l) => console.log(l));
console.log('\n================ 错误 ================');
if (errors.length === 0) console.log('无错误 ✅');
else errors.forEach((e) => console.log(e));

await browser.close();
fs.writeFileSync(path.join(OUT, 'report.txt'),
  errors.length ? errors.join('\n') : 'NO_ERRORS', 'utf8');
console.log('\nRESULT:', errors.length ? 'ERRORS=' + errors.length : 'CLEAN');
