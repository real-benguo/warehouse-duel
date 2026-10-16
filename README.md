# 仓库单挑 · Warehouse Duel

浏览器里的第一人称单挑枪战。开一局，选电脑端或手机端，和 AI 在仓库里打到 5 分。

**纯静态网站**，没有后端、没有账号、没有依赖 CDN —— three.js 和模型全部打包在仓库里，GitHub Pages 直接就能跑。

## 怎么玩

打开页面先选设备端，两边操作完全不同：

**电脑端**

| 操作 | 按键 |
|---|---|
| 移动 | `W` `A` `S` `D` |
| 转视角 | 鼠标（点一下画面锁定指针，`Esc` 解锁并暂停） |
| 开火 | 鼠标左键 |
| 开镜 | 鼠标右键 |
| 疾跑 / 跳跃 / 换弹 | `Shift` / `空格` / `R` |
| 换枪 | `1`~`6` 或滚轮 |

**手机端**

左半屏任意位置按下出摇杆移动（推到最外圈自动疾跑），右半屏拖动转视角，
右下角按钮开火 / 开镜 / 换弹 / 跳跃 / 换枪。**横屏体验最好。**

## 规则

每人 100 血，把对方打死得 1 分，先到 5 分赢。爆头伤害翻倍，打腿减伤。
六把枪各有脾气：突击步枪均衡、冲锋枪泼水、霰弹枪贴脸、狙击枪一枪一个、手枪换枪快、机枪火力压制。
开镜能大幅收紧弹道，但移动变慢。

## 本地跑

因为用了 ES module，不能直接双击 `index.html`（浏览器会拦），要起一个静态服务：

```bash
python -m http.server 8777
# 然后打开 http://127.0.0.1:8777/
```

## 部署到 GitHub Pages

```bash
gh repo create warehouse-duel --public --source=. --push
gh api -X POST repos/:owner/warehouse-duel/pages \
  -f source[branch]=main -f source[path]=/
```

之后访问 `https://<你的用户名>.github.io/warehouse-duel/`。

## 目录

```
index.html          页面骨架 + 所有界面
css/style.css       全部样式
js/                 游戏代码（ES module）
  config.js         参数与六把枪的数据表
  world.js          场景、灯光、地图碰撞（全 AABB）
  weapons.js        视图模型、开火节奏、后坐力、开镜
  enemy.js          敌人 AI（感知 → 交战 → 走位 → 换弹）
  game.js           玩家控制、命中判定、回合制、主循环
  hud.js            准心、血条、弹药、比分
  input.js          键鼠（指针锁定）与触屏，统一成一份状态
  audio.js          音效，全部 WebAudio 现场合成，零音频文件
  net.js            联机适配器接口（见下）
vendor/             本地化的 three.js r169 + GLTFLoader
assets/
  models/*.glb      Blender 导出的模型
  map.json          碰撞盒 / 出生点 / 灯位（与 GLB 同一坐标系）
  weapons.json      每把枪的枪口、抛壳口、准心锚点
tools/              开发用脚本，不影响线上
  build_assets.py   Blender 参数化建模，一条命令重新生成全部模型
  verify_assets.py  校验 GLB 结构与出生点合理性
  browser_test.mjs  无头浏览器实测：跑通全部界面 + 40 秒实战冒烟
```

## 重新生成模型

模型不是手工雕的，是脚本参数化生成的 —— 改数值就能改枪型：

```bash
blender --background --factory-startup --python tools/build_assets.py
```

`tools/build_assets.py` 里 `GUNS` 表定义了六把枪的机匣长度、枪管粗细、弹匣倾角、瞄具类型；
`define_map()` 定义了仓库的集装箱、木箱、水泥柱、掩体、吊灯。改完跑一遍，GLB 和 `map.json` 一起更新。

## 联机接口（预留）

`js/net.js` 里 `Game` 只通过一组固定接口跟对手通信：`spawn / update / rayHit / applyDamage / isAlive / getState`。
现在挂的是 `LocalAIAdapter`（本地机器人）。要做真人对战，实现一个 `PeerAdapter`
（WebRTC DataChannel 互发 `getState()` 快照 + 本地插值）替换掉就行，`game.js` 一行都不用改。
骨架已经写在 `PeerAdapter` 里了。

## 已知限制

- 目前只支持 1v1，对手是 AI。
- 手机端用软件渲染跑不满帧的话，去设置里把画质调到「低」。
- 没有音频文件，音效是现场合成的，所以音色偏电子感。
