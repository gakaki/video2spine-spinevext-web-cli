//! SpineVExt 的核心算法库。
//!
//! 这里只做一件事：把 `decode` / `preprocess` / `smooth` / `rig` /
//! `animate` / `spine` / `atlas` 这些纯 Rust 模块，用 `wasm-bindgen`
//! 暴露成一层薄薄的、TypeScript 友好的 API。
//! TypeScript 侧（`src/core/engine.ts`）只负责编排、渲染与 IO。
//!
//! 结构化参数与返回值统一走 `serde-wasm-bindgen`，字段名在
//! `#[serde(rename_all = "camelCase")]` 下与 `src/core/types.ts` 一一对应。

pub mod animate;
pub mod atlas;
pub mod decode;
pub mod preprocess;
pub mod rig;
pub mod smooth;
pub mod spine;
pub mod types;

use wasm_bindgen::prelude::*;

use animate::{AnimConfig, AnimationData};
use atlas::{PackConfig, PackLayout};
use rig::{BoneFrame, RigConfig};
use serde::de::DeserializeOwned;
use spine::ExportConfig;
use types::{DecodeConfig, ImageTransform, Pose2D, SmoothConfig};

fn parse<T: DeserializeOwned>(value: JsValue, label: &str) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&format!("{label} 参数解析失败: {error}")))
}

fn emit<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    // `serialize_missing_as_null` 让 Rust 的 `Option::None` 变成 JS 的 `null`
    // 而不是 `undefined`，TS 侧 `string | null` 的类型才能对上。
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    value
        .serialize(&serializer)
        .map_err(|error| JsValue::from_str(&format!("返回值序列化失败: {error}")))
}

/// 核心库版本号。
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 导出的 Spine JSON 声明的格式版本（与 `spine::SPINE_VERSION` 同源）。
///
/// 角色工程导出（`src/core/character-project.ts`）也要写同一个版本号，
/// 从这里读就不会出现"两份导出的版本对不上"。
#[wasm_bindgen(js_name = spineVersion)]
pub fn spine_version() -> String {
    spine::SPINE_VERSION.to_string()
}

/// COCO-17 关节点名字，顺序与模型输出通道一致。
#[wasm_bindgen(js_name = keypointNames)]
pub fn keypoint_names() -> Vec<String> {
    decode::keypoint_names()
}

/// 计算预处理时使用的坐标变换；解码阶段要用同一份参数把坐标映射回源图。
#[wasm_bindgen(js_name = transformFor)]
pub fn transform_for(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Result<JsValue, JsValue> {
    emit(&preprocess::transform_for(src_w, src_h, dst_w, dst_h))
}

/// 预处理：RGBA 图 → 归一化 NCHW `f32` 张量。
#[wasm_bindgen(js_name = preprocess)]
#[allow(clippy::too_many_arguments)]
pub fn preprocess(
    rgba: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    mean: &[f32],
    scale: f32,
    flip_x: bool,
) -> Vec<f32> {
    preprocess::preprocess(rgba, src_w, src_h, dst_w, dst_h, mean, scale, flip_x)
}

/// 解码 PoseNet 输出。
///
/// * `heatmaps` —— `[1, H, W, num_parts]` 或 `[1, num_parts, H, W]`
/// * `offsets` —— 同 H/W，通道数为 `2 * num_parts`
/// * `displacements_fwd` / `displacements_bwd` —— 多姿态位移，可传空数组
#[wasm_bindgen(js_name = decodePoses)]
#[allow(clippy::too_many_arguments)]
pub fn decode_poses(
    heatmaps: &[f32],
    offsets: &[f32],
    displacements_fwd: &[f32],
    displacements_bwd: &[f32],
    heatmap_w: u32,
    heatmap_h: u32,
    num_parts: u32,
    cfg: JsValue,
) -> Result<JsValue, JsValue> {
    let cfg: DecodeConfig = parse(cfg, "decodePoses")?;
    let poses = decode::decode(
        heatmaps,
        offsets,
        displacements_fwd,
        displacements_bwd,
        heatmap_h as usize,
        heatmap_w as usize,
        num_parts as usize,
        &cfg,
    );
    emit(&poses)
}

/// 直接回归型模型（MoveNet / SinglePose）的解码。
///
/// * `values` —— `[1, 1, num_parts, 3]` 展平后的数据，(y, x, score) 归一化
/// * `transform` —— 与 `preprocessLetterbox` 返回的同一份变换
/// * 返回的坐标已经换算成源图像素
#[wasm_bindgen(js_name = decodeRegression)]
pub fn decode_regression(
    values: &[f32],
    num_parts: u32,
    model_width: u32,
    model_height: u32,
    transform: JsValue,
) -> Result<JsValue, JsValue> {
    let transform: ImageTransform = parse(transform, "decodeRegression")?;
    let pose = decode::decode_regression(
        values,
        num_parts as usize,
        model_width,
        model_height,
        &transform,
    );
    emit(&pose)
}

/// letterbox 预处理：RGBA 图 → `[1, H, W, 3]` 整型 RGB。
#[wasm_bindgen(js_name = preprocessLetterbox)]
#[allow(clippy::too_many_arguments)]
pub fn preprocess_letterbox(
    rgba: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    flip_x: bool,
) -> Vec<i32> {
    preprocess::preprocess_letterbox(rgba, src_w, src_h, dst_w, dst_h, flip_x)
}

/// letterbox 的坐标变换，供 `decodeRegression` 把坐标映射回源图。
#[wasm_bindgen(js_name = letterboxTransformFor)]
pub fn letterbox_transform_for(
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Result<JsValue, JsValue> {
    emit(&preprocess::letterbox_transform(src_w, src_h, dst_w, dst_h))
}

/// 时序平滑：逐帧姿态序列 → 平滑后序列。
#[wasm_bindgen(js_name = smoothPoses)]
pub fn smooth_poses(frames: JsValue, cfg: JsValue) -> Result<JsValue, JsValue> {
    let frames: Vec<Vec<Pose2D>> = parse(frames, "smoothPoses.frames")?;
    let cfg: SmoothConfig = parse(cfg, "smoothPoses")?;
    emit(&smooth::smooth_poses(&frames, &cfg))
}

/// 对单条角度序列做圆周三滑，用于骨骼角度与测试。
#[wasm_bindgen(js_name = smoothAngleSeries)]
pub fn smooth_angle_series(values: &[f32], buffer_size: u32) -> Vec<f32> {
    smooth::smooth_angle_series(values, buffer_size)
}

/// 姿态序列 → 逐帧骨骼局部旋转角。
#[wasm_bindgen(js_name = posesToBones)]
pub fn poses_to_bones(
    frames: JsValue,
    cfg: JsValue,
    image_height: f32,
) -> Result<JsValue, JsValue> {
    let frames: Vec<Vec<Pose2D>> = parse(frames, "posesToBones.frames")?;
    let cfg: RigConfig = parse(cfg, "posesToBones")?;
    let bones: Vec<BoneFrame> = rig::poses_to_bones(&frames, &cfg, image_height);
    emit(&bones)
}

/// 基准帧选取 + 传播 + 骨骼静止姿态推导。
#[wasm_bindgen(js_name = buildAnimation)]
pub fn build_animation(
    bones: JsValue,
    frames: JsValue,
    cfg: JsValue,
    rig_cfg: JsValue,
    image_height: f32,
) -> Result<JsValue, JsValue> {
    let bones: Vec<BoneFrame> = parse(bones, "buildAnimation.bones")?;
    let frames: Vec<Vec<Pose2D>> = parse(frames, "buildAnimation.frames")?;
    let cfg: AnimConfig = parse(cfg, "buildAnimation")?;
    let rig_cfg: RigConfig = parse(rig_cfg, "buildAnimation.rig")?;
    let data: AnimationData =
        animate::build_animation(&bones, &frames, &cfg, &rig_cfg, image_height);
    emit(&data)
}

/// 生成 Spine 4.3 JSON 文本。
#[wasm_bindgen(js_name = buildSpineJson)]
pub fn build_spine_json(anim: JsValue, cfg: JsValue) -> Result<String, JsValue> {
    let anim: AnimationData = parse(anim, "buildSpineJson.anim")?;
    let cfg: ExportConfig = parse(cfg, "buildSpineJson")?;
    spine::build_spine_json(&anim, &cfg).map_err(|error| JsValue::from_str(&error))
}

/// 帧装箱：算出每帧在图集里的位置。
#[wasm_bindgen(js_name = packFrames)]
pub fn pack_frames(
    frame_w: u32,
    frame_h: u32,
    count: u32,
    cfg: JsValue,
) -> Result<JsValue, JsValue> {
    let cfg: PackConfig = parse(cfg, "packFrames")?;
    let layout: PackLayout =
        atlas::pack_frames(frame_w, frame_h, count, &cfg).map_err(|error| JsValue::from_str(&error))?;
    emit(&layout)
}

/// 生成 `.atlas` 文本。
#[wasm_bindgen(js_name = buildAtlas)]
pub fn build_atlas(
    layout: JsValue,
    image_name: String,
    filter: String,
    repeat: String,
) -> Result<String, JsValue> {
    let layout: PackLayout = parse(layout, "buildAtlas")?;
    Ok(atlas::build_atlas(&layout, &image_name, &filter, &repeat))
}

/// 默认的坐标变换，便于 TS 侧在没有源图尺寸时兜底。
#[wasm_bindgen(js_name = identityTransform)]
pub fn identity_transform() -> Result<JsValue, JsValue> {
    emit(&ImageTransform::default())
}
