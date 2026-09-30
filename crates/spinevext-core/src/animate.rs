//! 基准帧选取、缺失骨骼回填与动画烘焙。
//!
//! 对应原版的 `GetBaseFrame` / `baseBones` / `firstCapWithFullBones` /
//! `maxConfidentPartialBoneSets` / `PropogateList` / `PropogateJson`：
//! 先挑出「骨骼最完整、置信度最高」的一帧作为基准，再用它把后续帧里
//! 丢失或低置信度的骨骼补上，最终得到一段连续可播放的骨骼动画。

use serde::{Deserialize, Serialize};

use crate::rig::{
    absolute_angles, bone, distance_or, local_offset, rig_points, BoneFrame, Point2, RigConfig,
    RigPoints, BONE_NAMES, BONE_PARENTS,
};
use crate::types::Pose2D;

/// 导出用骨骼定义（静止姿态）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonBone {
    pub name: String,
    /// 父骨骼名；根骨骼为 `None`。
    pub parent: Option<String>,
    pub length: f32,
    pub x: f32,
    pub y: f32,
    pub rotation: f32,
}

/// 动画烘焙配置。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AnimConfig {
    pub fps: f32,
    /// `-1` 表示自动挑选基准帧。
    pub base_frame: i32,
    /// 是否把无效帧回填成基准帧（原版 `PropogateList` 的行为）。
    pub propagate: bool,
}

impl Default for AnimConfig {
    fn default() -> Self {
        Self {
            fps: 30.0,
            base_frame: -1,
            propagate: true,
        }
    }
}

/// 烘焙结果。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationData {
    pub fps: f32,
    pub base_frame: usize,
    /// 长度等于帧数，元素是每根骨骼的局部旋转角（度，顺序同 `BONE_NAMES`）。
    pub frames: Vec<Vec<f32>>,
    /// 每帧是否有效，供 UI 标出置信度不足的区段。
    pub validity: Vec<bool>,
    pub skeleton: Vec<SkeletonBone>,
    /// 根骨骼在画布里的位置（y 向上）。
    pub root_x: f32,
    pub root_y: f32,
}

/// 找出骨骼最完整的一帧：优先比较「是否有效」，其次比较置信度。
pub fn pick_base_frame(bones: &[BoneFrame]) -> usize {
    let mut best = 0usize;
    let mut best_score = f32::NEG_INFINITY;
    for (index, frame) in bones.iter().enumerate() {
        let score = if frame.valid {
            1.0 + frame.confidence
        } else {
            frame.confidence
        };
        if score > best_score {
            best_score = score;
            best = index;
        }
    }
    best
}

/// 从基准帧的姿态推导骨骼长度与静止姿态。
fn build_skeleton(
    points: &RigPoints,
    angles: &[Option<f32>; 14],
    root: Option<Point2>,
) -> Vec<SkeletonBone> {
    let torso_angle = angles[bone::TORSO].unwrap_or(0.0);

    let torso_length = distance_or(points.hip_center, points.neck, 100.0);
    let head_length = distance_or(points.neck, points.head_tip, torso_length * 0.45);
    let arm_upper = [
        distance_or(points.shoulder[0], points.elbow[0], torso_length * 0.5),
        distance_or(points.shoulder[1], points.elbow[1], torso_length * 0.5),
    ];
    let arm_lower = [
        distance_or(points.elbow[0], points.wrist[0], arm_upper[0] * 0.9),
        distance_or(points.elbow[1], points.wrist[1], arm_upper[1] * 0.9),
    ];
    let leg_upper = [
        distance_or(points.hip[0], points.knee[0], torso_length * 0.9),
        distance_or(points.hip[1], points.knee[1], torso_length * 0.9),
    ];
    let leg_lower = [
        distance_or(points.knee[0], points.ankle[0], leg_upper[0]),
        distance_or(points.knee[1], points.ankle[1], leg_upper[1]),
    ];

    let shoulder_local = [
        local_offset(points.neck, points.shoulder[0], torso_angle),
        local_offset(points.neck, points.shoulder[1], torso_angle),
    ];
    let hip_local = [
        // hip 骨不旋转，左右髋的位置直接取世界偏移
        local_offset(points.hip_center, points.hip[0], 0.0),
        local_offset(points.hip_center, points.hip[1], 0.0),
    ];

    let length_of = |index: usize| -> f32 {
        match index {
            bone::ROOT | bone::HIP => 0.0,
            bone::TORSO => torso_length,
            bone::HEAD => head_length.max(torso_length * 0.25),
            bone::UPPER_ARM_L => arm_upper[0],
            bone::LOWER_ARM_L => arm_lower[0],
            bone::UPPER_ARM_R => arm_upper[1],
            bone::LOWER_ARM_R => arm_lower[1],
            bone::UPPER_LEG_L => leg_upper[0],
            bone::LOWER_LEG_L => leg_lower[0],
            bone::UPPER_LEG_R => leg_upper[1],
            bone::LOWER_LEG_R => leg_lower[1],
            bone::FOOT_L => leg_lower[0] * 0.5,
            bone::FOOT_R => leg_lower[1] * 0.5,
            _ => 0.0,
        }
    };

    let rest_local = |index: usize| -> f32 {
        let value = angles[index].unwrap_or(0.0);
        let parent = BONE_PARENTS[index]
            .and_then(|parent| angles[parent])
            .unwrap_or(0.0);
        crate::smooth::clamp_angle(value - parent)
    };

    BONE_NAMES
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let (x, y) = match index {
                bone::ROOT => (
                    root.map(|p| p.x).unwrap_or(0.0),
                    root.map(|p| p.y).unwrap_or(0.0),
                ),
                bone::HEAD => (length_of(bone::TORSO), 0.0),
                bone::UPPER_ARM_L => shoulder_local[0],
                bone::UPPER_ARM_R => shoulder_local[1],
                bone::UPPER_LEG_L => hip_local[0],
                bone::UPPER_LEG_R => hip_local[1],
                bone::LOWER_ARM_L => (length_of(bone::UPPER_ARM_L), 0.0),
                bone::LOWER_ARM_R => (length_of(bone::UPPER_ARM_R), 0.0),
                bone::LOWER_LEG_L => (length_of(bone::UPPER_LEG_L), 0.0),
                bone::LOWER_LEG_R => (length_of(bone::UPPER_LEG_R), 0.0),
                bone::FOOT_L => (length_of(bone::LOWER_LEG_L), 0.0),
                bone::FOOT_R => (length_of(bone::LOWER_LEG_R), 0.0),
                _ => (0.0, 0.0),
            };
            SkeletonBone {
                name: (*name).to_string(),
                parent: BONE_PARENTS[index].map(|parent| BONE_NAMES[parent].to_string()),
                length: length_of(index),
                x,
                y,
                rotation: rest_local(index),
            }
        })
        .collect()
}

/// 姿态序列 + 骨骼序列 → 可直接导出的动画数据。
pub fn build_animation(
    bones: &[BoneFrame],
    poses: &[Vec<Pose2D>],
    cfg: &AnimConfig,
    rig_cfg: &RigConfig,
    image_height: f32,
) -> AnimationData {
    let frame_count = bones.len();
    let base_frame = if cfg.base_frame >= 0 && (cfg.base_frame as usize) < frame_count {
        cfg.base_frame as usize
    } else if frame_count == 0 {
        0
    } else {
        pick_base_frame(bones)
    };

    let zero = vec![0.0f32; BONE_NAMES.len()];
    let base_rotations = bones
        .get(base_frame)
        .map(|frame| frame.rotations.clone())
        .unwrap_or(zero);

    let frames: Vec<Vec<f32>> = bones
        .iter()
        .map(|frame| {
            if cfg.propagate && !frame.valid {
                base_rotations.clone()
            } else {
                frame.rotations.clone()
            }
        })
        .collect();

    // 基准帧的姿态点 → 骨骼静止姿态
    let base_pose = poses
        .get(base_frame)
        .and_then(|frame| {
            frame
                .iter()
                .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal))
        })
        .cloned()
        .unwrap_or_default();
    let points = rig_points(&base_pose, rig_cfg, image_height);
    let angles = absolute_angles(&base_pose, rig_cfg, image_height);
    let skeleton = build_skeleton(&points, &angles, points.hip_center);

    AnimationData {
        fps: cfg.fps,
        base_frame,
        frames,
        validity: bones.iter().map(|frame| frame.valid).collect(),
        skeleton,
        root_x: points.hip_center.map(|p| p.x).unwrap_or(0.0),
        root_y: points.hip_center.map(|p| p.y).unwrap_or(0.0),
    }
}
