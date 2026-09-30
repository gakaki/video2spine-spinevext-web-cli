# SpineVExt HTML5 复刻（video → Spine）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust/WASM + Vite + React + TypeScript + shadcn/ui + Vitest 复刻 SpineVExt V1.2 的核心能力——把一段人物视频（或摄像头画面）逐帧做 2D 人体姿态估计，再把姿态烘焙成一套带骨骼动画的 Spine 骨架工程（JSON + Atlas + PNG）导出。

**Architecture:** 浏览器端把原版 Unity 管线整体搬过来：视频解码/取帧换成 `<video>` + Canvas，神经网络前向换成 ONNX Runtime Web（原版是 Barracuda），而**所有算法核心**（图像预处理、heatmap 解码、多人 NMS、置信度过滤、角度平滑、姿态→骨骼映射、关键帧基准帧选取与传播、Spine JSON/Atlas 生成、图集装箱）全部由纯 Rust 编译成 `wasm32-unknown-unknown` 实现，通过 `wasm-bindgen` 绑定到 TypeScript。

**Tech Stack:** Rust 1.93（`wasm-bindgen` / `serde` / `serde-wasm-bindgen` / `wasm-pack`）、Vite 8（Rolldown）、React 19 + TypeScript、Tailwind CSS v4 + shadcn/ui、ONNX Runtime Web 1.2x（WASM/WebGPU）、Vitest 4、oxlint/oxfmt。

## Global Constraints

- 核心算法必须在 Rust 中实现，TypeScript 只做编排、渲染和 IO；不允许把核心算法用 TS 重写一份。
- Rust → WASM 目标固定 `wasm32-unknown-unknown`，构建命令固定 `wasm-pack build --target web --release --out-dir <repo>/src/wasm/pkg`。
- 关节点顺序固定为 COCO-17：nose, leftEye, rightEye, leftEar, rightEar, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist, leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle。
- 默认归一化参数固定 `mean=[0.482941176, 0.454509803, 0.404156862]`、`std=[1,1,1]`、`scale=255`（即 `pixel/255 - mean`），来自原版 asset 字符串 `resnet50-posenet-normalization-stats`。
- 导出格式固定 Spine JSON 3.8 结构：顶层键 `skeleton / bones / slots / skins / animations`。
- 所有面向用户的文案、文档、界面标签用中文；代码标识符、命令、日志用英文。
- 参考实现（Unity 原版）位于 `SpineVExtV1.2/`，只读，不进版本库。
- 不允许用 mock 数据冒充真实管线；导出必须来自真实视频帧与真实推理结果。

## 原版逆向结论（实现依据）

从 `SpineVExtV1.2/SpineVExt_Data/` 逆向得到的原始设计：

| 原版组件                                                         | 职责                          | 复刻对应物                                   |
| ---------------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| `AVProVideo` + `VideoPlayer`                                     | 视频/摄像头取帧               | `HTMLVideoElement` + `getUserMedia` + Canvas |
| `DeepLearningImageProcessor` / `NormalizeImage` shader           | 裁剪缩放 + 归一化             | Rust `preprocess`                            |
| `PoseNetPoseEstimator` (Barracuda, ResNet50)                     | 前向推理                      | ONNX Runtime Web（模型为 PoseNet 家族）      |
| `DecodeSinglePose` / `DecodeMultiplePoses`                       | heatmap argmax + offset + NMS | Rust `decode`                                |
| `AngleSmoothing` (`angleBuffer`, `SmoothAngle`, `ClampAngle`)    | 角度平滑                      | Rust `smooth`                                |
| `HumanPoseToBones` / `GenerateBonesForFrame`                     | 姿态 → 骨骼                   | Rust `rig`                                   |
| `GetBaseFrame` / `baseBones` / `PropogateList` / `PropogateJson` | 基准帧选取与缺失骨骼传播      | Rust `animate`                               |
| `GenerateSkins` / `GenerateSlots` / `CurrentBoneLayoutToTexture` | 帧图集与 slot/attachment      | Rust `atlas` + `spine`                       |
| `JSONModels/Spine.cs` (`Skeleton/Bone/Slot/Skin/Animation`)      | Spine JSON 序列化             | Rust `spine`                                 |
| `SaveJsonOutput` / `SimpleFileBrowser`                           | 落盘导出                      | File System Access API + JSZip 下载          |

内部脚本/命名证据：`Assets/VideoToSpineSkeleManager.cs`、`Assets/AngleSmoothing.cs`、`Assets/JSONModels/Spine.cs`、`Assets/SaveJsonOutput.cs`、`Assets/SkeletonCentering.cs`、`Assets/SkeletonScalerAndCenterer.cs`（原工程名 `Spine2DPostNetImporter`）。

## 文件结构

```
spinevext/
├── Cargo.toml                       # Rust workspace（members = ["crates/spinevext-core"]）
├── crates/spinevext-core/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                   # 唯一 wasm_bindgen 导出面
│       ├── types.rs                 # Keypoint/Pose2D/BodyPart 等共享类型（serde）
│       ├── preprocess.rs            # RGBA→NCHW 归一化 + 等比裁剪缩放
│       ├── decode.rs                # heatmap/offset 解码 + 多人 NMS
│       ├── smooth.rs                # 角度平滑（环形缓冲）
│       ├── rig.rs                   # 姿态→骨骼角度（HumanPoseToBones）
│       ├── animate.rs               # 基准帧选取、传播、动画烘焙
│       ├── spine.rs                 # Spine 3.8 JSON 数据模型与写出
│       └── atlas.rs                 # 帧装箱与 .atlas 文本生成
├── public/models/                   # PoseNet ONNX 模型
├── src/
│   ├── wasm/pkg/                    # wasm-pack 产物（git 忽略，构建生成）
│   ├── core/
│   │   ├── types.ts                 # 与 Rust serde 结构一一对应的 TS 类型
│   │   ├── engine.ts                # WASM 初始化 + 类型化包装
│   │   ├── inference.ts             # ONNX Runtime Web 会话
│   │   ├── video.ts                 # 视频/摄像头取帧
│   │   ├── pipeline.ts              # 端到端流水线编排
│   │   └── export.ts                # 导出 zip（json+atlas+png）
│   ├── components/                  # shadcn/ui 组件与业务面板
│   ├── App.tsx
│   └── main.tsx
├── tests/                           # Vitest
├── docs/原理.md                      # 原理说明（交付物）
└── docs/superpowers/plans/
```

## 冻结的接口契约

### Rust（`#[wasm_bindgen]` 导出，TS 侧一一对应）

```rust
// 版本与元信息
pub fn version() -> String;
pub fn keypoint_names() -> Vec<String>;           // COCO-17 顺序
pub fn default_skeleton_json() -> String;         // 参考骨架定义（bones/slots 树）

// 1. 预处理：RGBA 图像 → NCHW f32（已归一化）
pub fn preprocess(rgba: &[u8], src_w: u32, src_h: u32,
                  dst_w: u32, dst_h: u32,
                  mean: &[f32], scale: f32) -> Vec<f32>;

// 2. 解码：heatmap+offset(+fwd/bwd) → Pose2D[]（坐标为原图像素）
pub fn decode_poses(heatmaps: &[f32], offsets: &[f32],
                    fwd: &[f32], bwd: &[f32],
                    hm_w: u32, hm_h: u32, num_parts: u32,
                    src_w: u32, src_h: u32,
                    cfg: JsValue /* DecodeConfig */) -> Result<JsValue, JsValue>;

// 3. 平滑：逐帧姿态序列 → 平滑后序列
pub fn smooth_poses(frames: JsValue, cfg: JsValue /* SmoothConfig */)
                    -> Result<JsValue, JsValue>;

// 4. 骨骼：姿态序列 → 每帧骨骼变换
pub fn poses_to_bones(frames: JsValue, cfg: JsValue /* RigConfig */)
                      -> Result<JsValue, JsValue>;

// 5. 基准帧传播 + 动画烘焙 → 最终每帧骨骼
pub fn build_animation(bone_frames: JsValue, cfg: JsValue /* AnimConfig */)
                       -> Result<JsValue, JsValue>;

// 6. Spine 导出
pub fn build_spine_json(anim: JsValue, cfg: JsValue /* ExportConfig */) -> Result<String, JsValue>;
pub fn pack_frames(frame_w: u32, frame_h: u32, count: u32,
                   cfg: JsValue /* PackConfig */) -> Result<JsValue, JsValue>; // 布局
pub fn build_atlas(json_layout: JsValue, cfg: JsValue) -> Result<String, JsValue>;
```

`DecodeConfig { confidenceThreshold: f32, nmsRadius: f32, maxPoses: u32, stride: u32 }`
`SmoothConfig { bufferSize: u32 }`
`RigConfig { mirror: bool, center: bool, scaleToFit: bool, rootName: String }`
`AnimConfig { fps: f32, baseFrame: i32 /* -1 = 自动 */, fallbackToBase: bool }`
`ExportConfig { name: String, animationName: String, frameWidth, frameHeight, regionPrefix }`
`PackConfig { maxWidth: u32, padding: u32 }`

### TypeScript

```ts
export interface Keypoint {
  x: number;
  y: number;
  score: number;
}
export interface Pose2D {
  score: number;
  keypoints: Keypoint[];
}
export interface BoneTransform {
  name: string;
  rotation: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}
export interface BoneFrame {
  bones: BoneTransform[];
}
export interface PackedRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}
```

---

## Task 1: Rust workspace 与 WASM 骨架

**Files:**

- Create: `Cargo.toml`, `crates/spinevext-core/Cargo.toml`, `crates/spinevext-core/src/lib.rs`
- Create: `scripts/build-wasm.sh`

**Interfaces:**

- Produces: `version() -> String`、`keypoint_names() -> Vec<String>`，以及可被 `wasm-pack` 构建的 crate。

- [ ] 建 workspace 与 crate，`crate-type = ["cdylib", "rlib"]`，`js` 与 `wasm-bindgen` 依赖，`wasm-bindgen` 开 `serde-serialize`。
- [ ] 实现 `version()` 与 `keypoint_names()`，RUN `cargo test -p spinevext-core`（本地 host 目标先跑通）。
- [ ] RUN `bash scripts/build-wasm.sh`，EXPECT 生成 `src/wasm/pkg/spinevext_core.js` 与 `spinevext_core_bg.wasm`。
- [ ] Commit。

## Task 2: 图像预处理（Rust）

**Files:**

- Create: `crates/spinevext-core/src/preprocess.rs`
- Test: `crates/spinevext-core/tests/preprocess.rs`

**Interfaces:**

- Consumes: 无。
- Produces: `preprocess(rgba, src_w, src_h, dst_w, dst_h, mean, scale) -> Vec<f32>`，输出 NCHW `[1,3,dst_h,dst_w]`，值域 `pixel/scale - mean[c]`。

- [ ] 写失败测试：2x2 单色图 → 输出长度 `3*dst_h*dst_w`，且 channel 0 的值等于 `255/255 - mean[0]`。
- [ ] 跑测试 EXPECT FAIL。
- [ ] 实现：等比缩放（保持长宽比，居中裁剪到目标比例）+ 双线性插值 + 归一化。
- [ ] 跑测试 EXPECT PASS（含极端尺寸与全透明像素）。
- [ ] Commit。

## Task 3: PoseNet 解码与多人 NMS（Rust）

**Files:**

- Create: `crates/spinevext-core/src/decode.rs`, `crates/spinevext-core/src/types.rs`
- Test: `crates/spinevext-core/tests/decode.rs`

**Interfaces:**

- Produces: `decode_poses(...) -> Vec<Pose2D>`；单点 heatmap 峰值定位 = `argmax(h,w) -> (x*stride + offset_x, y*stride + offset_y)`，置信度 = `sigmoid(value)`。

- [ ] 写失败测试：构造 1 个已知峰值 heatmap（含 offset 修正）→ 期望解码出的坐标与像素坐标一致、score≈sigmoid(peak)。
- [ ] 写失败测试：两个距离 < nmsRadius 的同类峰值只保留高分者；> nmsRadius 的保留两个。
- [ ] 跑测试 EXPECT FAIL。
- [ ] 实现单姿态解码 + 基于 `confidenceThreshold/nmsRadius/maxPoses` 的多人解码（用 fwd/bwd 位移做 part 归属，缺失时退化为逐点独立解码）。
- [ ] 跑测试 EXPECT PASS。
- [ ] Commit。

## Task 4: 角度平滑（Rust）

**Files:**

- Create: `crates/spinevext-core/src/smooth.rs`
- Test: `crates/spinevext-core/tests/smooth.rs`

**Interfaces:**

- Produces: `smooth_poses(frames, SmoothConfig{bufferSize})`，等价原版 `angleBuffer` + `SmoothAngle` + `ClampAngle`（角度按最短弧插值，避免 ±180° 抖动）。

- [ ] 写失败测试：喂入 `[179°, -179°, 178°]` 序列，期望平滑结果接近 180° 而不是 0°。
- [ ] 写失败测试：`bufferSize=1` 时输出与输入完全一致。
- [ ] 跑测试 EXPECT FAIL → 实现 → EXPECT PASS。
- [ ] Commit。

## Task 5: 姿态 → 骨骼映射（Rust）

**Files:**

- Create: `crates/spinevext-core/src/rig.rs`
- Test: `crates/spinevext-core/tests/rig.rs`

**Interfaces:**

- Produces: `poses_to_bones(frames, RigConfig) -> Vec<BoneFrame>`；骨骼名固定为 `root / hip / torso / head / upperArm.L/R / lowerArm.L/R / upperLeg.L/R / lowerLeg.L/R / foot.L/R`，rotation 为**相对父骨骼的角度（度）**。

- [ ] 写失败测试：构造一个 T-pose 姿态，期望躯干角≈0、双臂近似水平、左右腿角度符号相反。
- [ ] 写失败测试：低置信度关节点被父/默认值替代，不产生 NaN。
- [ ] 跑测试 EXPECT FAIL → 实现 （root=髋中心，torso=髋→肩中点，head=肩中点→鼻，四肢=两点连线角；缺 arm 数据时回落到躯干角）→ EXPECT PASS。
- [ ] Commit。

## Task 6: 基准帧选取、传播与动画烘焙（Rust）

**Files:**

- Create: `crates/spinevext-core/src/animate.rs`
- Test: `crates/spinevext-core/tests/animate.rs`

**Interfaces:**

- Produces: `build_animation(bone_frames, AnimConfig) -> AnimationData{ fps, frames: Vec<BoneFrame>, baseFrame: usize, baseBones: ... }`，等价原版 `GetBaseFrame`（选“完整骨骼数最多、置信度最高”的帧）与 `PropogateList/PropogateJson`（缺失骨骼回落到基准帧）。

- [ ] 写失败测试：中间帧骨骼缺失 → 该帧输出等于基准帧；`baseFrame` 指定时不被自动选择覆盖。
- [ ] 跑测试 EXPECT FAIL → 实现 → EXPECT PASS。
- [ ] Commit。

## Task 7: Spine 3.8 JSON 导出（Rust）

**Files:**

- Create: `crates/spinevext-core/src/spine.rs`
- Test: `crates/spinevext-core/tests/spine.rs`

**Interfaces:**

- Produces: `build_spine_json(anim, ExportConfig) -> String`，结构：

```json
{
  "skeleton": { "hash": "...", "spine": "3.8.75", "width": 1920, "height": 1080, "images": "./" },
  "bones": [{ "name": "root" }, { "name": "hip", "parent": "root" }],
  "slots": [{ "name": "frame", "bone": "root", "attachment": "frame_0000" }],
  "skins": {
    "default": { "frame": { "frame_0000": { "x": 0, "y": 0, "width": 1920, "height": 1080 } } }
  },
  "animations": {
    "video": {
      "slots": { "frame": { "attachment": [{ "time": 0, "name": "frame_0000" }] } },
      "bones": { "hip": { "rotate": [{ "time": 0, "angle": 0 }] } }
    }
  }
}
```

- [ ] 写失败测试：给定 2 帧动画与 2 个 region，JSON 可被 `serde_json::from_str` 解析回来，且 `animations.video.slots.frame.attachment` 长度为 2、`bones.hip.rotate` 长度为 2。
- [ ] 跑测试 EXPECT FAIL → 实现（`AnimationAction{time, angle}` 语义：`rotate` 用 angle，`translate` 用 x/y）→ EXPECT PASS。
- [ ] Commit。

## Task 8: 帧装箱与 Atlas 文本（Rust）

**Files:**

- Create: `crates/spinevext-core/src/atlas.rs`
- Test: `crates/spinevext-core/tests/atlas.rs`

**Interfaces:**

- Produces: `pack_frames(w, h, count, PackConfig) -> PackLayout{ atlasWidth, atlasHeight, regions: Vec<PackedRegion> }` 与 `build_atlas(layout, cfg) -> String`。

- [ ] 写失败测试：100 帧 320x180 → 所有 region 不重叠、全部落在图集边界内、面积利用率 > 50%。
- [ ] 写失败测试：atlas 文本含 `size: <w>,<h>`、`format: RGBA8888`、每帧 `xy/index` 行。
- [ ] 跑测试 EXPECT FAIL → 实现（货架/天际线装箱 + 边长取 2 的幂并向上对齐）→ EXPECT PASS。
- [ ] Commit。

## Task 9: WASM 导出面与 TS 绑定层

**Files:**

- Create: `crates/spinevext-core/src/lib.rs`（汇总导出）
- Create: `src/core/types.ts`, `src/core/engine.ts`
- Test: `tests/engine.test.ts`

**Interfaces:**

- Produces: `loadEngine(): Promise<Engine>`；`Engine` 暴露 `preprocess / decodePoses / smoothPoses / posesToBones / buildAnimation / buildSpineJson / packFrames / buildAtlas / keypointNames / version`。

- [ ] `wasm-pack` 构建产物落到 `src/wasm/pkg`，`engine.ts` 用 `init()` + 类型包装，业务代码只依赖 `Engine` 接口。
- [ ] 写失败测试：`vitest` 中调用 `engine.version()` 与 `engine.keypointNames()`，期望得到 17 个名字且第 1 个是 `nose`。
- [ ] 跑测试 EXPECT FAIL（包装层未实现）→ 实现 → EXPECT PASS。
- [ ] Commit。

## Task 10: 推理与视频管线（TS）

**Files:**

- Create: `src/core/inference.ts`, `src/core/video.ts`, `src/core/pipeline.ts`
- Test: `tests/pipeline.test.ts`

- [ ] `inference.ts` 用 ONNX Runtime Web 建会话，输入 `[1,3,H,W]` Float32，输出解析为 `{heatmaps, offsets, fwd, bwd}`（按输出名/形状自动识别，兼容 MobileNet 与 ResNet50 两种 PoseNet）。
- [ ] `video.ts` 提供 `createFrameSource(video|stream)`：按 `fps * detectEveryNFrames` 逐帧 seek + `drawImage` + `getImageData`。
- [ ] `pipeline.ts` 串联：取帧 → `engine.preprocess` → 推理 → `engine.decodePoses` → 收集 `Pose2D[][]`。
- [ ] 写失败测试：用合成的假 heatmap 直接跑 `pipeline` 的**后处理段**（跳过推理），断言输出帧数、坐标缩放正确。
- [ ] 跑测试 EXPECT FAIL → 实现 → EXPECT PASS。
- [ ] Commit。

## Task 11: UI（React + shadcn/ui）

**Files:**

- Create: `src/App.tsx`, `src/components/*.tsx`, `src/components/ui/*`（shadcn 生成）
- Create: `vite.config.ts`, `tailwind` 配置, `index.html`

- [ ] `pnpm create vite` 建 React+TS 工程，接入 Tailwind v4 与 shadcn/ui（`pnpm dlx shadcn@latest init`）。
- [ ] 左侧「输入」面板：视频文件 / 摄像头开关、起止时间、检测间隔、置信度阈值、NMS 半径、最大人数、平滑窗口、镜像开关。
- [ ] 中间「舞台」：Canvas 叠加显示视频帧 + 关节点 + 骨骼线 + 时间轴滑块。
- [ ] 右侧「导出」面板：工程名、动画名、图集最大宽度、导出按钮 + 进度条 + 帧率/已检测人数统计。
- [ ] 界面标签全部中文。
- [ ] Commit。

## Task 12: 导出打包（TS）与端到端验证

**Files:**

- Create: `src/core/export.ts`
- Test: `tests/export.test.ts`

- [ ] `export.ts` 用 `engine.packFrames` 得到布局 → Canvas 合成 PNG → `JSZip` 打包 `name.json` / `name.atlas` / `name.png` 并触发下载。
- [ ] 写失败测试：假布局 + 假帧 → 生成的 zip 内包含 3 个文件且文件名正确。
- [ ] 跑测试 EXPECT PASS。
- [ ] 在真实浏览器里跑完整流程（真实视频 → 导出），截图确认渲染与一次交互。
- [ ] Commit。

## Task 13: 原理文档与交付说明

**Files:**

- Create: `docs/原理.md`, `README.md`

- [ ] `docs/原理.md` 覆盖：视频取帧、预处理数学、PoseNet 结构与输出语义、heatmap 解码公式、多人 NMS、角度平滑、姿态→骨骼映射表、基准帧传播、Spine JSON/Atlas 格式详解、Rust↔TS 边界与内存布局、与原版 Unity 实现的逐项对照与差异。
- [ ] `README.md` 写安装、构建（含 Rust/WASM）、开发、测试、导出的使用步骤。
- [ ] Commit。

---

## Self-Review

1. **Spec coverage**：视频输入(T10/T11)、姿态估计(T3/T10)、骨骼生成(T5/T6)、Spine 导出(T7/T8/T12)、Rust 核心(T1–T9)、TS 绑定(T9)、UI(T11)、Vitest(T2–T9/T12)、原理文档(T13) 均有对应任务。
2. **Placeholder scan**：无 TBD/TODO；每个任务都给出了具体接口与可执行断言。
3. **Type consistency**：`Pose2D.keypoints[i].{x,y,score}`、`BoneFrame.bones[i].{name,rotation,x,y,scaleX,scaleY}`、`PackedRegion.{name,x,y,width,height,index}` 在 Rust 与 TS 两侧同名同义。
