//! 2D 姿态 → 骨骼角度。
//!
//! 对应原版的 `HumanPoseToBones` / `GenerateBonesForFrame`：
//! 把 COCO-17 关节点连成一条有向骨骼树，逐帧算出每根骨骼的**局部旋转角**。
//!
//! 坐标系约定：视频像素坐标 y 向下，这里统一翻成 **y 向上** 的数学坐标系，
//! 这样角度就是标准的 `atan2(dy, dx)`。

use serde::{Deserialize, Serialize};

use crate::types::{part, Pose2D};

/// 骨骼名（同时决定导出 JSON 里的命名）。
pub const BONE_NAMES: [&str; 14] = [
    "root",
    "hip",
    "torso",
    "head",
    "upperArm.L",
    "lowerArm.L",
    "upperArm.R",
    "lowerArm.R",
    "upperLeg.L",
    "lowerLeg.L",
    "upperLeg.R",
    "lowerLeg.R",
    "foot.L",
    "foot.R",
];

/// 索引常量。
pub mod bone {
    pub const ROOT: usize = 0;
    pub const HIP: usize = 1;
    pub const TORSO: usize = 2;
    pub const HEAD: usize = 3;
    pub const UPPER_ARM_L: usize = 4;
    pub const LOWER_ARM_L: usize = 5;
    pub const UPPER_ARM_R: usize = 6;
    pub const LOWER_ARM_R: usize = 7;
    pub const UPPER_LEG_L: usize = 8;
    pub const LOWER_LEG_L: usize = 9;
    pub const UPPER_LEG_R: usize = 10;
    pub const LOWER_LEG_R: usize = 11;
    pub const FOOT_L: usize = 12;
    pub const FOOT_R: usize = 13;
}

/// 骨骼树的父节点（`None` 表示根）。
pub const BONE_PARENTS: [Option<usize>; 14] = [
    None,
    Some(bone::ROOT),
    Some(bone::HIP),
    Some(bone::TORSO),
    Some(bone::TORSO),
    Some(bone::UPPER_ARM_L),
    Some(bone::TORSO),
    Some(bone::UPPER_ARM_R),
    Some(bone::HIP),
    Some(bone::UPPER_LEG_L),
    Some(bone::HIP),
    Some(bone::UPPER_LEG_R),
    Some(bone::LOWER_LEG_L),
    Some(bone::LOWER_LEG_R),
];

/// 一帧的骨骼状态。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoneFrame {
    /// 长度固定为 `BONE_NAMES.len()`，顺序与 `BONE_NAMES` 一致。
    pub rotations: Vec<f32>,
    /// 该帧姿态的平均置信度。
    pub confidence: f32,
    /// 是否至少有足够的关节点支撑这帧骨骼（等价原版 `confident`）。
    pub valid: bool,
}

/// 骨骼映射参数。
///
/// 注意：水平镜像不在这里做。镜像必须在取帧/预处理阶段翻转图像
/// （见 [`crate::preprocess::preprocess`] 的 `flip_x`），否则关节点坐标与
/// 视频画面会左右错位，导出到 Spine 后骨架对不上画面。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RigConfig {
    /// 判定一帧可用的最少高置信度关节点数量。
    pub min_confident_keypoints: u32,
    /// 关节点置信度阈值。
    pub confidence_threshold: f32,
}

impl Default for RigConfig {
    fn default() -> Self {
        Self {
            min_confident_keypoints: 6,
            confidence_threshold: 0.25,
        }
    }
}

/// 姿态在「y 向上」坐标系里的关键点。
#[derive(Clone, Copy, Debug)]
pub struct Point2 {
    pub x: f32,
    pub y: f32,
}

/// 从姿态里取值并做有效性判断。
fn point(pose: &Pose2D, index: usize, cfg: &RigConfig, image_height: f32) -> Option<Point2> {
    let keypoint = pose.keypoints.get(index)?;
    if keypoint.score < cfg.confidence_threshold {
        return None;
    }
    Some(Point2 {
        x: keypoint.x,
        y: image_height - keypoint.y,
    })
}

fn midpoint(a: Option<Point2>, b: Option<Point2>) -> Option<Point2> {
    match (a, b) {
        (Some(a), Some(b)) => Some(Point2 {
            x: (a.x + b.x) * 0.5,
            y: (a.y + b.y) * 0.5,
        }),
        (Some(only), None) | (None, Some(only)) => Some(only),
        _ => None,
    }
}

fn angle_between(from: Point2, to: Point2) -> f32 {
    (to.y - from.y).atan2(to.x - from.x).to_degrees()
}

/// 一根骨骼在某一帧的绝对角度（度）。
pub fn absolute_angles(
    pose: &Pose2D,
    cfg: &RigConfig,
    image_height: f32,
) -> [Option<f32>; 14] {
    let get = |index: usize| point(pose, index, cfg, image_height);

    let hip_left = get(part::LEFT_HIP);
    let hip_right = get(part::RIGHT_HIP);
    let shoulder_left = get(part::LEFT_SHOULDER);
    let shoulder_right = get(part::RIGHT_SHOULDER);
    let nose = get(part::NOSE);
    let eye = get(part::LEFT_EYE).or_else(|| get(part::RIGHT_EYE));
    let ear = get(part::LEFT_EAR).or_else(|| get(part::RIGHT_EAR));

    let hips = midpoint(hip_left, hip_right);
    let shoulders = midpoint(shoulder_left, shoulder_right);
    let head_tip = nose.or(ear).or(eye);

    let torso_angle = match (hips, shoulders) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => None,
    };

    let mut angles: [Option<f32>; 14] = [None; 14];
    angles[bone::ROOT] = Some(0.0);
    // hip 是骨盆，保持与世界对齐（旋转 0），让 torso 承载真正的躯干倾角——
    // 这样在 Spine 里 torso 曲线是活的，腿也挂在骨盆这个静止原点上，符合常见绑定习惯。
    angles[bone::HIP] = Some(0.0);
    angles[bone::TORSO] = torso_angle;
    angles[bone::HEAD] = match (shoulders, head_tip) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => torso_angle,
    };

    angles[bone::UPPER_ARM_L] = match (shoulder_left, get(part::LEFT_ELBOW)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => torso_angle,
    };
    angles[bone::LOWER_ARM_L] = match (get(part::LEFT_ELBOW), get(part::LEFT_WRIST)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => angles[bone::UPPER_ARM_L],
    };
    angles[bone::UPPER_ARM_R] = match (shoulder_right, get(part::RIGHT_ELBOW)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => torso_angle,
    };
    angles[bone::LOWER_ARM_R] = match (get(part::RIGHT_ELBOW), get(part::RIGHT_WRIST)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => angles[bone::UPPER_ARM_R],
    };

    angles[bone::UPPER_LEG_L] = match (hip_left.or(hips), get(part::LEFT_KNEE)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => Some(-90.0),
    };
    angles[bone::LOWER_LEG_L] = match (get(part::LEFT_KNEE), get(part::LEFT_ANKLE)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => angles[bone::UPPER_LEG_L],
    };
    angles[bone::UPPER_LEG_R] = match (hip_right.or(hips), get(part::RIGHT_KNEE)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => Some(-90.0),
    };
    angles[bone::LOWER_LEG_R] = match (get(part::RIGHT_KNEE), get(part::RIGHT_ANKLE)) {
        (Some(a), Some(b)) => Some(angle_between(a, b)),
        _ => angles[bone::UPPER_LEG_R],
    };
    // 脚：默认水平伸出，作为可再编辑的辅助骨
    angles[bone::FOOT_L] = Some(0.0);
    angles[bone::FOOT_R] = Some(0.0);

    angles
}

/// 姿态里与骨骼树直接相关的关键点。
#[derive(Clone, Debug, Default)]
pub struct RigPoints {
    pub hip_center: Option<Point2>,
    pub neck: Option<Point2>,
    pub head_tip: Option<Point2>,
    /// 下标 0 = 左，1 = 右。
    pub hip: [Option<Point2>; 2],
    pub shoulder: [Option<Point2>; 2],
    pub elbow: [Option<Point2>; 2],
    pub wrist: [Option<Point2>; 2],
    pub knee: [Option<Point2>; 2],
    pub ankle: [Option<Point2>; 2],
}

/// 取出骨骼树的全部关键点。下标 0 = 左，1 = 右。
pub fn rig_points(pose: &Pose2D, cfg: &RigConfig, image_height: f32) -> RigPoints {
    let get = |index: usize| point(pose, index, cfg, image_height);

    let hip = [get(part::LEFT_HIP), get(part::RIGHT_HIP)];
    let shoulder = [get(part::LEFT_SHOULDER), get(part::RIGHT_SHOULDER)];
    let head_tip = get(part::NOSE)
        .or_else(|| get(part::LEFT_EYE))
        .or_else(|| get(part::RIGHT_EYE));

    RigPoints {
        hip_center: midpoint(hip[0], hip[1]),
        neck: midpoint(shoulder[0], shoulder[1]),
        head_tip,
        hip,
        shoulder,
        elbow: [get(part::LEFT_ELBOW), get(part::RIGHT_ELBOW)],
        wrist: [get(part::LEFT_WRIST), get(part::RIGHT_WRIST)],
        knee: [get(part::LEFT_KNEE), get(part::RIGHT_KNEE)],
        ankle: [get(part::LEFT_ANKLE), get(part::RIGHT_ANKLE)],
    }
}

/// 两点距离，任意一端缺失时返回回退值。
pub fn distance_or(a: Option<Point2>, b: Option<Point2>, fallback: f32) -> f32 {
    match (a, b) {
        (Some(a), Some(b)) => ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt(),
        _ => fallback,
    }
}

/// 在父骨骼的局部坐标系里表示 `child - parent` 的偏移。
pub fn local_offset(
    parent: Option<Point2>,
    child: Option<Point2>,
    parent_angle: f32,
) -> (f32, f32) {
    match (parent, child) {
        (Some(parent), Some(child)) => {
            let (dx, dy) = (child.x - parent.x, child.y - parent.y);
            let radians = -parent_angle.to_radians();
            let (sin, cos) = radians.sin_cos();
            (dx * cos - dy * sin, dx * sin + dy * cos)
        }
        _ => (0.0, 0.0),
    }
}

/// 姿态序列 → 逐帧局部旋转角。
pub fn poses_to_bones(
    frames: &[Vec<Pose2D>],
    cfg: &RigConfig,
    image_height: f32,
) -> Vec<BoneFrame> {
    frames
        .iter()
        .map(|poses| {
            // 原版是「一人一段视频」的定位，这里取当前帧置信度最高的人
            let pose = poses.iter().max_by(|a, b| {
                a.score
                    .partial_cmp(&b.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let Some(pose) = pose else {
                return BoneFrame {
                    rotations: vec![0.0; BONE_NAMES.len()],
                    confidence: 0.0,
                    valid: false,
                };
            };
            let confident = pose.confident_count(cfg.confidence_threshold);
            let absolute = absolute_angles(pose, cfg, image_height);
            let mut rotations = vec![0.0f32; BONE_NAMES.len()];
            for index in 0..BONE_NAMES.len() {
                let value = absolute[index].unwrap_or(0.0);
                let parent = BONE_PARENTS[index]
                    .and_then(|parent| absolute[parent])
                    .unwrap_or(0.0);
                rotations[index] = crate::smooth::clamp_angle(value - parent);
            }
            BoneFrame {
                rotations,
                confidence: pose.score,
                valid: confident >= cfg.min_confident_keypoints as usize,
            }
        })
        .collect()
}
