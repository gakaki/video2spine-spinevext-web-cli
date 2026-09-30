//! `spinevext-core` 的 napi-rs 绑定。
//!
//! 同一个 Rust 核心被绑定两次：
//! * `crates/spinevext-core` 用 `wasm-bindgen` 编译成 `wasm32-unknown-unknown`，
//!   供浏览器里的 HTML5 应用使用；
//! * 本 crate 用 `napi-rs` 编译成 Node 原生插件（`.node`），
//!   供 Node / CLI / 批处理使用。
//!
//! 算法只有一份，绑定层各自薄薄一层。所有结构体都是 `#[napi(object)]`，
//! `napi build` 会据此生成完整的 `index.d.ts`。

use napi::bindgen_prelude::{Float32Array, Int32Array, Uint8Array};
use napi_derive::napi;

use spinevext_core::animate::{
    build_animation, AnimConfig, AnimationData, SkeletonBone,
};
use spinevext_core::atlas::{build_atlas, pack_frames, PackConfig, PackLayout, PackedRegion};
use spinevext_core::decode::{self, decode_regression};
use spinevext_core::preprocess;
use spinevext_core::rig::{poses_to_bones, BoneFrame, RigConfig};
use spinevext_core::smooth::{smooth_angle_series, smooth_poses};
use spinevext_core::spine::{build_spine_json, ExportConfig};
use spinevext_core::types::{
    DecodeConfig, ImageTransform, Keypoint, OffsetOrder, Pose2D, SmoothConfig, TensorLayout,
};

// ---------------------------------------------------------------- 结构映射

#[napi(object)]
#[derive(Clone)]
pub struct KeypointDto {
    pub x: f64,
    pub y: f64,
    pub score: f64,
}

impl From<Keypoint> for KeypointDto {
    fn from(value: Keypoint) -> Self {
        Self {
            x: value.x as f64,
            y: value.y as f64,
            score: value.score as f64,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct Pose2DDto {
    pub score: f64,
    pub keypoints: Vec<KeypointDto>,
}

impl From<Pose2D> for Pose2DDto {
    fn from(value: Pose2D) -> Self {
        Self {
            score: value.score as f64,
            keypoints: value.keypoints.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<&Pose2DDto> for Pose2D {
    fn from(value: &Pose2DDto) -> Self {
        Pose2D {
            score: value.score as f32,
            keypoints: value
                .keypoints
                .iter()
                .map(|keypoint| Keypoint::new(keypoint.x as f32, keypoint.y as f32, keypoint.score as f32))
                .collect(),
        }
    }
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct ImageTransformDto {
    pub scale: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

impl From<ImageTransform> for ImageTransformDto {
    fn from(value: ImageTransform) -> Self {
        Self {
            scale: value.scale as f64,
            offset_x: value.offset_x as f64,
            offset_y: value.offset_y as f64,
        }
    }
}

impl From<&ImageTransformDto> for ImageTransform {
    fn from(value: &ImageTransformDto) -> Self {
        ImageTransform {
            scale: value.scale as f32,
            offset_x: value.offset_x as f32,
            offset_y: value.offset_y as f32,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct DecodeConfigDto {
    pub confidence_threshold: f64,
    pub nms_radius: f64,
    pub max_poses: u32,
    pub stride: u32,
    pub multi_pose: bool,
    /// `"nhwc"` 或 `"nchw"`。
    pub heatmap_layout: String,
    pub offset_layout: String,
    /// `"yx"` 或 `"xy"`。
    pub offset_order: String,
    pub displacement_layout: String,
    pub offset_in_pixels: bool,
}

fn tensor_layout(value: &str) -> TensorLayout {
    match value {
        "nchw" => TensorLayout::Nchw,
        _ => TensorLayout::Nhwc,
    }
}

impl From<&DecodeConfigDto> for DecodeConfig {
    fn from(value: &DecodeConfigDto) -> Self {
        DecodeConfig {
            confidence_threshold: value.confidence_threshold as f32,
            nms_radius: value.nms_radius as f32,
            max_poses: value.max_poses,
            stride: value.stride,
            multi_pose: value.multi_pose,
            heatmap_layout: tensor_layout(&value.heatmap_layout),
            offset_layout: tensor_layout(&value.offset_layout),
            offset_order: if value.offset_order == "xy" {
                OffsetOrder::Xy
            } else {
                OffsetOrder::Yx
            },
            displacement_layout: tensor_layout(&value.displacement_layout),
            offset_in_pixels: value.offset_in_pixels,
            transform: ImageTransform::default(),
        }
    }
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct SmoothConfigDto {
    pub buffer_size: u32,
    pub confidence_threshold: f64,
}

impl From<SmoothConfigDto> for SmoothConfig {
    fn from(value: SmoothConfigDto) -> Self {
        Self {
            buffer_size: value.buffer_size,
            confidence_threshold: value.confidence_threshold as f32,
        }
    }
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct RigConfigDto {
    pub min_confident_keypoints: u32,
    pub confidence_threshold: f64,
}

impl From<RigConfigDto> for RigConfig {
    fn from(value: RigConfigDto) -> Self {
        Self {
            min_confident_keypoints: value.min_confident_keypoints,
            confidence_threshold: value.confidence_threshold as f32,
        }
    }
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct AnimConfigDto {
    pub fps: f64,
    pub base_frame: i32,
    pub propagate: bool,
}

impl From<AnimConfigDto> for AnimConfig {
    fn from(value: AnimConfigDto) -> Self {
        Self {
            fps: value.fps as f32,
            base_frame: value.base_frame,
            propagate: value.propagate,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct BoneFrameDto {
    pub rotations: Vec<f64>,
    pub confidence: f64,
    pub valid: bool,
}

impl From<BoneFrame> for BoneFrameDto {
    fn from(value: BoneFrame) -> Self {
        Self {
            rotations: value.rotations.into_iter().map(f64::from).collect(),
            confidence: value.confidence as f64,
            valid: value.valid,
        }
    }
}

impl From<&BoneFrameDto> for BoneFrame {
    fn from(value: &BoneFrameDto) -> Self {
        Self {
            rotations: value.rotations.iter().map(|angle| *angle as f32).collect(),
            confidence: value.confidence as f32,
            valid: value.valid,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct SkeletonBoneDto {
    pub name: String,
    pub parent: Option<String>,
    pub length: f64,
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
}

impl From<SkeletonBone> for SkeletonBoneDto {
    fn from(value: SkeletonBone) -> Self {
        Self {
            name: value.name,
            parent: value.parent,
            length: value.length as f64,
            x: value.x as f64,
            y: value.y as f64,
            rotation: value.rotation as f64,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct AnimationDataDto {
    pub fps: f64,
    pub base_frame: u32,
    pub frames: Vec<Vec<f64>>,
    pub validity: Vec<bool>,
    pub skeleton: Vec<SkeletonBoneDto>,
    pub root_x: f64,
    pub root_y: f64,
}

impl From<AnimationData> for AnimationDataDto {
    fn from(value: AnimationData) -> Self {
        Self {
            fps: value.fps as f64,
            base_frame: value.base_frame as u32,
            frames: value
                .frames
                .into_iter()
                .map(|frame| frame.into_iter().map(f64::from).collect())
                .collect(),
            validity: value.validity,
            skeleton: value.skeleton.into_iter().map(Into::into).collect(),
            root_x: value.root_x as f64,
            root_y: value.root_y as f64,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct ExportConfigDto {
    pub name: String,
    pub animation_name: String,
    pub frame_width: f64,
    pub frame_height: f64,
    pub frame_count: u32,
    pub fps: f64,
    pub region_prefix: String,
    pub image_name: String,
    pub image_scale: f64,
}

impl From<ExportConfigDto> for ExportConfig {
    fn from(value: ExportConfigDto) -> Self {
        Self {
            name: value.name,
            animation_name: value.animation_name,
            frame_width: value.frame_width as f32,
            frame_height: value.frame_height as f32,
            frame_count: value.frame_count,
            fps: value.fps as f32,
            region_prefix: value.region_prefix,
            image_name: value.image_name,
            image_scale: value.image_scale as f32,
        }
    }
}

#[napi(object)]
#[derive(Clone, Copy)]
pub struct PackConfigDto {
    pub max_width: u32,
    pub padding: u32,
    pub scale: f64,
}

impl From<PackConfigDto> for PackConfig {
    fn from(value: PackConfigDto) -> Self {
        Self {
            max_width: value.max_width,
            padding: value.padding,
            scale: value.scale as f32,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct PackedRegionDto {
    pub name: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub index: u32,
}

impl From<PackedRegion> for PackedRegionDto {
    fn from(value: PackedRegion) -> Self {
        Self {
            name: value.name,
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            index: value.index,
        }
    }
}

#[napi(object)]
#[derive(Clone)]
pub struct PackLayoutDto {
    pub atlas_width: u32,
    pub atlas_height: u32,
    pub regions: Vec<PackedRegionDto>,
}

impl From<PackLayout> for PackLayoutDto {
    fn from(value: PackLayout) -> Self {
        Self {
            atlas_width: value.atlas_width,
            atlas_height: value.atlas_height,
            regions: value.regions.into_iter().map(Into::into).collect(),
        }
    }
}

// ------------------------------------------------------------------ 导出面

#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 导出的 Spine JSON 声明的格式版本（与 WASM 侧、与 `spine::SPINE_VERSION` 同源）。
#[napi(js_name = "spineVersion")]
pub fn spine_version() -> String {
    spinevext_core::spine::SPINE_VERSION.to_string()
}

#[napi(js_name = "keypointNames")]
pub fn keypoint_names() -> Vec<String> {
    decode::keypoint_names()
}

#[napi(js_name = "transformFor")]
pub fn transform_for(
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> ImageTransformDto {
    preprocess::transform_for(src_width, src_height, dst_width, dst_height).into()
}

#[napi(js_name = "preprocess")]
#[allow(clippy::too_many_arguments)]
pub fn preprocess_rgba(
    rgba: Uint8Array,
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
    mean: Vec<f64>,
    scale: f64,
    flip_x: bool,
) -> Float32Array {
    let mean: Vec<f32> = mean.into_iter().map(|value| value as f32).collect();
    preprocess::preprocess(
        rgba.as_ref(),
        src_width,
        src_height,
        dst_width,
        dst_height,
        &mean,
        scale as f32,
        flip_x,
    )
    .into()
}

#[napi(js_name = "preprocessLetterbox")]
#[allow(clippy::too_many_arguments)]
pub fn preprocess_letterbox_rgba(
    rgba: Uint8Array,
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
    flip_x: bool,
) -> Int32Array {
    preprocess::preprocess_letterbox(
        rgba.as_ref(),
        src_width,
        src_height,
        dst_width,
        dst_height,
        flip_x,
    )
    .into()
}

#[napi(js_name = "letterboxTransformFor")]
pub fn letterbox_transform_for(
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> ImageTransformDto {
    preprocess::letterbox_transform(src_width, src_height, dst_width, dst_height).into()
}

#[napi(js_name = "decodePoses")]
#[allow(clippy::too_many_arguments)]
pub fn decode_poses(
    heatmaps: Float32Array,
    offsets: Float32Array,
    displacements_fwd: Float32Array,
    displacements_bwd: Float32Array,
    heatmap_width: u32,
    heatmap_height: u32,
    num_parts: u32,
    config: DecodeConfigDto,
    transform: ImageTransformDto,
) -> Vec<Pose2DDto> {
    let mut cfg: DecodeConfig = (&config).into();
    cfg.transform = (&transform).into();
    decode::decode(
        heatmaps.as_ref(),
        offsets.as_ref(),
        displacements_fwd.as_ref(),
        displacements_bwd.as_ref(),
        heatmap_height as usize,
        heatmap_width as usize,
        num_parts as usize,
        &cfg,
    )
    .into_iter()
    .map(Into::into)
    .collect()
}

#[napi(js_name = "decodeRegression")]
pub fn decode_regression_output(
    values: Float32Array,
    num_parts: u32,
    model_width: u32,
    model_height: u32,
    transform: ImageTransformDto,
) -> Pose2DDto {
    let transform: ImageTransform = (&transform).into();
    decode_regression(
        values.as_ref(),
        num_parts as usize,
        model_width,
        model_height,
        &transform,
    )
    .into()
}

#[napi(js_name = "smoothPoses")]
pub fn smooth_poses_napi(frames: Vec<Vec<Pose2DDto>>, config: SmoothConfigDto) -> Vec<Vec<Pose2DDto>> {
    let frames: Vec<Vec<Pose2D>> = frames
        .iter()
        .map(|frame| frame.iter().map(Into::into).collect())
        .collect();
    smooth_poses(&frames, &config.into())
        .into_iter()
        .map(|frame| frame.into_iter().map(Into::into).collect())
        .collect()
}

#[napi(js_name = "smoothAngleSeries")]
pub fn smooth_angle_series_napi(values: Float32Array, buffer_size: u32) -> Float32Array {
    smooth_angle_series(values.as_ref(), buffer_size).into()
}

#[napi(js_name = "posesToBones")]
pub fn poses_to_bones_napi(
    frames: Vec<Vec<Pose2DDto>>,
    config: RigConfigDto,
    image_height: f64,
) -> Vec<BoneFrameDto> {
    let frames: Vec<Vec<Pose2D>> = frames
        .iter()
        .map(|frame| frame.iter().map(Into::into).collect())
        .collect();
    poses_to_bones(&frames, &config.into(), image_height as f32)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi(js_name = "buildAnimation")]
pub fn build_animation_napi(
    bones: Vec<BoneFrameDto>,
    frames: Vec<Vec<Pose2DDto>>,
    config: AnimConfigDto,
    rig_config: RigConfigDto,
    image_height: f64,
) -> AnimationDataDto {
    let bones: Vec<BoneFrame> = bones.iter().map(Into::into).collect();
    let frames: Vec<Vec<Pose2D>> = frames
        .iter()
        .map(|frame| frame.iter().map(Into::into).collect())
        .collect();
    build_animation(
        &bones,
        &frames,
        &config.into(),
        &rig_config.into(),
        image_height as f32,
    )
    .into()
}

#[napi(js_name = "buildSpineJson")]
pub fn build_spine_json_napi(
    animation: AnimationDataDto,
    config: ExportConfigDto,
) -> napi::Result<String> {
    let animation: AnimationData = animation_from_dto(&animation);
    build_spine_json(&animation, &config.into()).map_err(napi::Error::from_reason)
}

/// `AnimationDataDto` 是从核心结构单向转换来的，导出时再拼回核心结构。
fn animation_from_dto(value: &AnimationDataDto) -> AnimationData {
    AnimationData {
        fps: value.fps as f32,
        base_frame: value.base_frame as usize,
        frames: value
            .frames
            .iter()
            .map(|frame| frame.iter().map(|angle| *angle as f32).collect())
            .collect(),
        validity: value.validity.clone(),
        skeleton: value
            .skeleton
            .iter()
            .map(|bone| SkeletonBone {
                name: bone.name.clone(),
                parent: bone.parent.clone(),
                length: bone.length as f32,
                x: bone.x as f32,
                y: bone.y as f32,
                rotation: bone.rotation as f32,
            })
            .collect(),
        root_x: value.root_x as f32,
        root_y: value.root_y as f32,
    }
}

#[napi(js_name = "packFrames")]
pub fn pack_frames_napi(
    frame_width: u32,
    frame_height: u32,
    count: u32,
    config: PackConfigDto,
) -> napi::Result<PackLayoutDto> {
    pack_frames(frame_width, frame_height, count, &config.into())
        .map(Into::into)
        .map_err(napi::Error::from_reason)
}

#[napi(js_name = "buildAtlas")]
pub fn build_atlas_napi(
    layout: PackLayoutDto,
    image_name: String,
    filter: String,
    repeat: String,
) -> String {
    let layout = PackLayout {
        atlas_width: layout.atlas_width,
        atlas_height: layout.atlas_height,
        regions: layout
            .regions
            .into_iter()
            .map(|region| PackedRegion {
                name: region.name,
                x: region.x,
                y: region.y,
                width: region.width,
                height: region.height,
                index: region.index,
            })
            .collect(),
    };
    build_atlas(&layout, &image_name, &filter, &repeat)
}
