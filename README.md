# SpineVExt · 视频转 Spine 骨骼动画

**中文** · [English](README.en.md) · [日本語](README.ja.md)

把一段人物视频（或摄像头画面）转成能在 [Spine](https://esotericsoftware.com/) 里直接打开的
**骨骼动画工程**：`<工程名>.json` + `<工程名>.atlas` + `<工程名>.png`。

**启发自 [SpineVExt](https://jcupdev.itch.io/spinevext)** —— jcupdev 做的 Unity 桌面工具
（video → spine，用 Unity + Barracuda 跑 ResNet50 PoseNet）。见下面的
[「启发来源」](#启发来源spinevext原版)。

本仓库不是它的移植或分支，而是**独立重写**：把整条管线搬到浏览器与命令行，
**所有算法核心（解码、平滑、骨骼映射、动画烘焙、Spine 导出、图集装箱）都用 Rust 写，
一份代码绑定三次**。

> 算法与公式、与原版的逐项对照、以及踩过的坑，见 [`docs/原理.md`](docs/原理.md)。

## 启发来源：SpineVExt（原版）

**灵感与功能目标都来自 [SpineVExt](https://jcupdev.itch.io/spinevext)**（作者 jcupdev）：

- 工具页：[jcupdev.itch.io/spinevext](https://jcupdev.itch.io/spinevext)
- 1.2 版发布说明：[Version 1.2 Release](https://jcupdev.itch.io/spinevext/devlog/667627/version-12-release)
  （1.1：[Version 1.1 Release](https://jcupdev.itch.io/spinevext/devlog/664575/version-11-release)）

原版是一个 Unity 桌面工具：输入人物视频 / 摄像头画面，用 Barracuda 跑 ResNet50 PoseNet 估计
姿态，再把关键点转成 Spine 骨骼动画，界面上有 Inspector 参数（confidence / nmsRadius /
maxPoses / GetBaseFrame / PropogateList 等）——本仓库的界面与配置项刻意保留了这些概念，
方便对照（逐项对照写在 [`docs/原理.md`](docs/原理.md) 第 11 节）。

与原版的关系：

- **独立重写，不含原版代码**：算法核心是 Rust（约 5 千行），跑在浏览器（wasm-bindgen +
  onnxruntime-web）和命令行（napi-rs / 纯 Rust CLI + tract-onnx）两条路上；
- **多出来的部分**：实时双屏预览（左屏画面+骨架、右屏 Spine 角色跟着动）、角色工程导出
  （把视频动作重定向到自己的角色骨骼）、白天/黑夜主题、中文/English/日本語 三语界面；
- 内置演示角色 **Spineboy** 来自 Spine 官方示例，遵循 Spine Runtimes License；
  原版工具与其素材的版权归 jcupdev 所有。

## 演示视频

[`docs/demo/spinevext-demo.mp4`](docs/demo/spinevext-demo.mp4)（2.7 MB / 1600×980 / 48 秒，中文字幕烧进画面）

内容：载入视频 → 开始检测（14 根骨骼 / 基准帧 #32）→ 左屏实时画面+骨架、右屏 Spine 角色同步跟随
→ 换角色 → 上传自己的 Spine 工程（骨骼名自动识别）→ 导出角色工程 → 白天/黑夜主题
→ 视频帧图集模式对比，末尾接纯 Rust CLI 的终端实录。
字幕文件在 [`docs/demo/spinevext-demo.srt`](docs/demo/spinevext-demo.srt)（`.ass` 是烧字幕用的样式版）。

### 用法速览（英文界面 · 中英双语字幕）

![SpineVExt 用法速览](docs/demo/spinevext-guide-en.webp)

[`docs/demo/spinevext-guide-en.webp`](docs/demo/spinevext-guide-en.webp)
（1000×610 / 28.6 秒 / **0.6 MB**，动图 WebP，GitHub 与各浏览器都能直接播放）：英文界面走一遍
载入视频 → 开始检测 → 实时跟随 → 选导出模式 → 导出的完整流程。
同样的内容另存了一份 GIF —— [`spinevext-guide-en.gif`](docs/demo/spinevext-guide-en.gif)（2.3 MB，
给不支持动图 WebP 的地方用）；字幕样式源文件是同一目录的 `.ass`。

## 三种运行形态

| 形态        | 入口                         | 绑定方式       | 推理运行时            |
| ----------- | ---------------------------- | -------------- | --------------------- |
| 浏览器应用  | `vp dev` / `vp build`        | wasm-bindgen   | onnxruntime-web       |
| Node CLI    | `pnpm exec cli`              | napi-rs        | onnxruntime-node      |
| 纯 Rust CLI | `cargo run -p spinevext-cli` | 直接依赖 crate | tract-onnx（纯 Rust） |

三者共用 `crates/spinevext-core`，没有重复实现。

## 快速开始

需要 Node 20+、pnpm、Rust 工具链（含 `wasm32-unknown-unknown` 目标）。

```bash
pnpm install
pnpm exec vp run setup     # 下载模型 + 建 WASM + 建 napi 原生绑定
pnpm exec vp dev           # 打开 http://localhost:5183
```

界面里：左侧选视频 / 摄像头 → 「开始检测」→ 中间逐帧检查骨架 → 右侧导出 zip。

### 命令

本项目已迁移到 **Vite+**（统一工具链 `vp`）：

| 命令                             | 作用                                            |
| -------------------------------- | ----------------------------------------------- |
| `vp dev`                         | 开发服务器（默认 5183，已放开 host / CORS）     |
| `vp build`                       | 生产构建到 `dist/`                              |
| `pnpm run serve`                 | 用带正确 MIME 与宽松 CORS 的静态服务器托管 dist |
| `vp test run`                    | Vitest（52 个用例，含 1 个真跑视频的集成用例）  |
| `vp check`                       | 格式化 + 类型感知 lint + 类型检查（0 error）    |
| `vp run rust:test`               | Rust 工作区测试（32 个用例）                    |
| `vp run wasm`                    | 编译 WASM 内核                                  |
| `vp run native`                  | 编译 napi 原生绑定                              |
| `vp run setup` / `vp run verify` | 一次性准备 / 交付前全量校验                     |

`vp` 是 Vite+ 的 CLI（项目内安装在 `vite-plus` 里，用 `pnpm exec vp` 调用）。
任务定义在 `vite.config.ts` 的 `run.tasks` 里，带依赖与缓存。

## 命令行用法

### 纯 Rust CLI（不需要 Node）

```bash
cargo run -p spinevext-cli --release -- input.mp4 --out ./out \
  --fps 15 --max-width 960 --confidence 0.3 --smooth 5
```

只依赖系统的 `ffmpeg` / `ffprobe`（取帧）与 Rust 本身；推理用纯 Rust 的 `tract-onnx`。
输出 `out/<工程名>.json` / `.atlas` / `.png` / `.zip`。

实测（MacBook，单线程 CPU）：2 秒 30 帧的视频 **1.0 秒**跑完，**内存峰值 212MB**。

默认策略：模型被剪过图（只剩卷积主干）就打开 tract 的算子融合——同一个优化器
在**原始** MoveNet 图上会吃掉 20GB+ 内存且跑不完，在图剪干净之后只要 0.05s，
推理快约 5 倍，结果逐帧完全一致（_见 `docs/原理.md` 第 10 节_）。
需要时用 `--no-optimize` / `--optimize` 覆盖。

### Node CLI

```bash
pnpm install
pnpm exec cli input.mp4 --out ./out --fps 15
```

用 `onnxruntime-node` 跑完整 MoveNet 模型，其余同样交给 Rust 内核。

## 工作流

1. 取帧：`<video>` / ffmpeg → RGBA；
2. 预处理（Rust）：按模型家族走 letterbox(NHWC) 或 cover 裁剪(NCHW)；
3. 推理：MoveNet / PoseNet 家族 ONNX，自动识别输出布局；
4. 解码（Rust）：heatmap argmax + offsets + 置信度 + 多人 NMS；
5. 平滑（Rust）：置信度加权 + 圆周角度平均；
6. 骨骼（Rust）：17 关键点 → 14 根骨骼的局部旋转角；
7. 烘焙（Rust）：基准帧选取、缺失骨骼传播；
8. 导出（Rust）：Spine 4.3 JSON（格式版本锁定 `4.3.23`）+ `.atlas` + 图集 PNG（+ zip）；
9. **实时双屏**：左屏是视频/摄像头 + 骨架（真·实时刷新），右屏是 Spine 演示角色跟着人动；
10. 预览：官方 `@esotericsoftware/spine-webgl` 运行时在页面里实时播放导出的工程（可暂停、变速、缩放）。

导出有两条路（见上面的「导出：角色工程 / 视频帧图集」）：把检测结果烘焙到角色骨骼上，
或者把视频帧本身打包成图集。

界面支持**白天 / 黑夜主题**（标题栏右上角切换，选择写进 localStorage）。

### 界面语言（i18n）

标题栏右侧可以切 **中文 / English / 日本語**，选择写进 localStorage；没存过就跟随浏览器语言
（`zh*` → 中文、`ja*` → 日本語，其余 → English），同时会更新 `<html lang>`。

文案集中在一张表里：[`src/i18n/dictionary.ts`](src/i18n/dictionary.ts)，key 用点分层级、
和来源文件一一对应。加一门语言只要在 `LANGUAGES` 里加一个代码、给每个 key 补一列；
`tests/i18n.test.ts` 会检查**每种语言的 key 是否齐全、占位符 `{name}` 是否对齐**，
还会扫组件文件，发现硬编码的中文（注释除外）就报错。

状态栏的消息存的是 key + 参数而不是翻好的字符串，所以**切换语言时已显示的消息会立刻重译**。

### 演示角色（姿态实时重定向）

舞台右侧内置一个演示角色，视频和摄像头都会实时驱动它：

| 角色             | 来源                                           |
| ---------------- | ---------------------------------------------- |
| Spineboy         | Spine 官方示例 `examples/spineboy`（8 根骨骼） |
| 你自己上传的工程 | 导出面板里的「选择 zip 或 json + atlas + png」 |

驱动方式是「加法式局部旋转」：`角色骨骼.rotation = 角色静止角 +（当前帧局部角 − 基准帧局部角）`，
不需要标定骨骼长度或朝向；没检测到人时角色播自己的待机动画。

上传的工程会自动认骨骼名：`torso / head / arm-l / leg-r`、`front-upper-arm / rear-thigh`、
`upperArm.L / upperLeg.R` 三种常见命名都能猜出映射（`guessRig`），猜不出任何一根时会明确报错。
想加内置角色，把它放进 `public/demo/<名字>/`（JSON + atlas + PNG），再在
`src/core/character.ts` 的 `DEMO_CHARACTERS` 里加一条即可。

### 导出：角色工程 / 视频帧图集

右侧导出面板的「导出内容」决定产物是什么，两者都是 Spine 4.3 工程（JSON + atlas + PNG + zip）：
两种产物声明的**格式版本都锁在 `4.3.23`**（Rust 里的 `spine::SPINE_VERSION` 是唯一事实来源，
角色工程经 `engine.spineVersion` 读同一个值写入）。

| 模式       | 骨架与美术           | 动画数据                               | 适合                        |
| ---------- | -------------------- | -------------------------------------- | --------------------------- |
| 角色工程   | 角色自己的           | **刚才视频检测出的骨骼角度**（重定向） | 拿角色资产 + 真人动作做动画 |
| 视频帧图集 | 视频画面（每帧一图） | 只切槽位附件，不含骨骼旋转             | 要保留原始画面的逐帧还原    |

角色工程模式下，导出的 `<工程名>.json` 里写的是
`animations.<动画名>.bones.<角色骨骼>.rotate`，数值等于
`角色骨骼静止角 + clamp(该帧局部角 − 基准帧局部角, ±60°)`；图集和图片完全来自角色，
不含任何视频帧。

导出的工程是**直接能在 Spine 编辑器里打开**的，导出时会做三件归一化
（`normalizeCharacterProject`，细节见 [`docs/原理.md`](docs/原理.md) 第 8.7 节）：

- 去掉 `skeleton.images`（编辑器会把它拼在页名前面，于是 `images: "./images/"` + 页名
  `images/tail-fin.png` 会去找 `images/images/tail-fin.png`，整只角色都是 `MISSING`），
  页图片平铺到工程根目录；
- 非 ASCII 部位名换成英文名（用该 region 所在页的文件名：`脸→face`、`左臂→arm-l`、
  `后发→hair-back`…），骨架 JSON 里的槽位名 / 附件名 / 动画引用一起改；
- 每个页块前保证有一个空行——Spine 的 `TextureAtlas` 靠空行判断"这里是新的一页"，
  源文件漏了或在 region 之间多写了都会解析错；
- 已全英文的工程（官方 Spineboy）名字原样保留，只平铺页路径、规范空行。

回归测试直接用官方运行时加载导出的工程（`Region not found in atlas` 会当场抛错），
跑的是真实素材，见 `tests/character-project.test.ts`。修旧产物可以跑
`node_modules/.bin/jiti scripts/normalize-export.ts <旧导出目录> <新导出目录>`。

做过的端到端验证见 `tests/character-export.integration.test.ts`：
用纯 Rust CLI 真跑一遍 `.test-assets/person-rot.mp4`，再把真实检测出的骨骼烘焙到
Spineboy 上，解 zip 断言产物里只有角色自己的 JSON / atlas / PNG。

## 目录

```
crates/spinevext-core/   算法内核（无 wasm / node 依赖，可单独测试）
crates/spinevext-node/   napi-rs 绑定（Node 用）
crates/spinevext-cli/    纯 Rust CLI（tract-onnx 推理 + ffmpeg 取帧）
src/core/                TS 侧编排：引擎封装、推理、取帧、流水线、导出
src/components/          界面（shadcn/ui + Tailwind v4）
src/wasm/pkg/            wasm-pack 产物（构建生成，已忽略）
native/                  napi 产物（构建生成，保留生成的 index.d.ts）
public/models/           姿态模型
docs/原理.md              算法原理与实现说明
```

## 已知限制

- MoveNet 是单人模型：多人场景只会输出置信度最高的一人；需要多人时换成
  PoseNet（heatmap + offset）家族的 ONNX，内核已支持多人与 NMS。
- 浏览器里 ONNX Runtime 用单线程 WASM（避免 COOP/COEP 要求），长视频建议降低采样帧率。
- 导出的图集是未压缩 RGBA；帧多、分辨率高时请调小「图集缩放」。
