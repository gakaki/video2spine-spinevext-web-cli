//! 全流程共享的数据类型。
//!
//! 这里的字段名会通过 `serde` 以 camelCase 序列化成 JS 对象，
//! 因此 Rust 侧与 TypeScript 侧（`src/core/types.ts`）保持一一对应。

use serde::{Deserialize, Serialize};

/// COCO-17 关节点顺序。
///
/// 该顺序直接来自原版 Unity 资源里的 `posenet-body-parts` 常量，
/// 顺序错了会导致所有骨骼都连错地方。
pub const KEYPOINT_NAMES: [&str; 17] = [
    "nose",
    "leftEye",
    "rightEye",
    "leftEar",
    "rightEar",
    "leftShoulder",
    "rightShoulder",
    "leftElbow",
    "rightElbow",
    "leftWrist",
    "rightWrist",
    "leftHip",
    "rightHip",
    "leftKnee",
    "rightKnee",
    "leftAnkle",
    "rightAnkle",
];

/// COCO-17 关节点的下标常量，避免在代码里出现魔法数字。
pub mod part {
    pub const NOSE: usize = 0;
    pub const LEFT_EYE: usize = 1;
    pub const RIGHT_EYE: usize = 2;
    pub const LEFT_EAR: usize = 3;
    pub const RIGHT_EAR: usize = 4;
    pub const LEFT_SHOULDER: usize = 5;
    pub const RIGHT_SHOULDER: usize = 6;
    pub const LEFT_ELBOW: usize = 7;
    pub const RIGHT_ELBOW: usize = 8;
    pub const LEFT_WRIST: usize = 9;
    pub const RIGHT_WRIST: usize = 10;
    pub const LEFT_HIP: usize = 11;
    pub const RIGHT_HIP: usize = 12;
    pub const LEFT_KNEE: usize = 13;
    pub const RIGHT_KNEE: usize = 14;
    pub const LEFT_ANKLE: usize = 15;
    pub const RIGHT_ANKLE: usize = 16;
}

/// 单个关节点的图像坐标（像素）与置信度。
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keypoint {
    pub x: f32,
    pub y: f32,
    pub score: f32,
}

impl Keypoint {
    pub fn new(x: f32, y: f32, score: f32) -> Self {
        Self { x, y, score }
    }

    /// 置信度低于阈值时视为无效点。
    pub fn is_confident(&self, threshold: f32) -> bool {
        self.score >= threshold
    }
}

/// 一帧里的一个人（或多人模式下的其中一人）。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pose2D {
    pub score: f32,
    pub keypoints: Vec<Keypoint>,
}

impl Pose2D {
    pub fn empty(num_keypoints: usize) -> Self {
        Self {
            score: 0.0,
            keypoints: vec![Keypoint::default(); num_keypoints],
        }
    }

    /// 置信度达标的关节点数量。
    pub fn confident_count(&self, threshold: f32) -> usize {
        self.keypoints
            .iter()
            .filter(|keypoint| keypoint.is_confident(threshold))
            .count()
    }
}

/// 「cover」等比缩放 + 居中裁剪的坐标变换。
///
/// 原版 Unity 的 `CalculateInputDims` / `CropInputDims` 就是这个语义：
/// 先把源图按长边贴满模型输入，再把多出来的部分从两侧对称裁掉。
/// 解码出来的坐标需要用同一组参数映射回源图像素坐标。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTransform {
    pub scale: f32,
    pub offset_x: f32,
    pub offset_y: f32,
}

impl ImageTransform {
    /// 计算把 `src` 贴满 `dst` 所需的缩放与裁剪偏移。
    pub fn cover(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Self {
        let sw = src_w.max(1) as f32;
        let sh = src_h.max(1) as f32;
        let scale = (dst_w as f32 / sw).max(dst_h as f32 / sh);
        Self {
            scale,
            offset_x: (dst_w as f32 - sw * scale) * 0.5,
            offset_y: (dst_h as f32 - sh * scale) * 0.5,
        }
    }

    /// 模型空间像素（连续坐标）→ 源图空间连续坐标。
    pub fn to_source(&self, x: f32, y: f32) -> (f32, f32) {
        (
            (x - self.offset_x) / self.scale,
            (y - self.offset_y) / self.scale,
        )
    }

    /// 源图空间连续坐标 → 模型输入空间连续坐标。
    pub fn to_model(&self, x: f32, y: f32) -> (f32, f32) {
        (x * self.scale + self.offset_x, y * self.scale + self.offset_y)
    }
}

impl Default for ImageTransform {
    fn default() -> Self {
        Self {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
        }
    }
}

/// 张量排布。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TensorLayout {
    /// `[1, height, width, channels]`
    Nhwc,
    /// `[1, channels, height, width]`
    Nchw,
}

/// 偏移量通道的排列顺序。
///
/// PoseNet 原始 TF 模型输出的是 `(y, x)` 顺序，部分重导出的模型会写成 `(x, y)`，
/// 所以这里做成可配置项。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OffsetOrder {
    Yx,
    Xy,
}

/// 解码参数，对应原版 Inspector 上的 confidence / nmsRadius / maxPoses。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DecodeConfig {
    /// 置信度阈值，范围 [0,1]，等价原版 `confidenceThreshold` / `scoreThreshold`。
    pub confidence_threshold: f32,
    /// 非极大值抑制半径，单位是模型输入像素，等价原版 `nmsRadius`。
    pub nms_radius: f32,
    /// 最多检测人数，等价原版 `maxPoses`。
    pub max_poses: u32,
    /// heatmap 相对于模型输入的下采样倍率，等价原版 `stride`。
    pub stride: u32,
    /// 是否启用多人解码（false 时退化为单人 argmax）。
    pub multi_pose: bool,
    pub heatmap_layout: TensorLayout,
    pub offset_layout: TensorLayout,
    pub offset_order: OffsetOrder,
    pub displacement_layout: TensorLayout,
    /// offsets 是否已经以模型输入像素为单位（TF 系列模型是）。
    /// 为 false 表示以 heatmap 单元为单位，需要乘以 stride。
    pub offset_in_pixels: bool,
    /// 解码坐标到源图的映射；缺省时保持模型输入坐标。
    pub transform: ImageTransform,
}

impl Default for DecodeConfig {
    fn default() -> Self {
        Self {
            confidence_threshold: 0.3,
            nms_radius: 20.0,
            max_poses: 1,
            stride: 16,
            multi_pose: false,
            heatmap_layout: TensorLayout::Nhwc,
            offset_layout: TensorLayout::Nhwc,
            offset_order: OffsetOrder::Yx,
            displacement_layout: TensorLayout::Nhwc,
            offset_in_pixels: true,
            transform: ImageTransform::default(),
        }
    }
}

/// 角度平滑参数，等价原版 `SmoothingBufferSize`。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SmoothConfig {
    /// 环形缓冲长度，1 表示不平滑。
    pub buffer_size: u32,
    /// 关节点置信度阈值，低于该值的点不参与平滑。
    pub confidence_threshold: f32,
}

impl Default for SmoothConfig {
    fn default() -> Self {
        Self {
            buffer_size: 5,
            confidence_threshold: 0.3,
        }
    }
}
