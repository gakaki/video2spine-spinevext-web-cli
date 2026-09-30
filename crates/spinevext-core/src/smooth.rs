//! 时序平滑。
//!
//! 对应原版的 `AngleSmoothing`（`angleBuffer` / `SmoothAngle` / `ClampAngle`）
//! 与 `SmoothAnimations`：把逐帧估计出来的抖动抹平。
//!
//! 两件事分开做：
//! * 关节点在笛卡尔坐标上做加权移动平均（按置信度加权）
//! * 骨骼角度在**圆周**上做平均，这样 179° 和 -179° 不会被平均成 0°

use crate::types::{Keypoint, Pose2D, SmoothConfig};

/// 把角度归一到 `(-180, 180]`。
pub fn clamp_angle(angle: f32) -> f32 {
    let mut a = (angle + 180.0) % 360.0;
    if a < 0.0 {
        a += 360.0;
    }
    a - 180.0
}

/// 环形窗口内的角度平均（用单位圆向量求和，天然处理跨 ±180° 的情况）。
pub fn smooth_angle(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let (mut sin_sum, mut cos_sum) = (0.0f32, 0.0f32);
    for value in values {
        let radians = value.to_radians();
        sin_sum += radians.sin();
        cos_sum += radians.cos();
    }
    clamp_angle(sin_sum.atan2(cos_sum).to_degrees())
}

/// 对整条角度序列做滑动窗口平滑；`buffer_size <= 1` 时原样返回。
pub fn smooth_angle_series(values: &[f32], buffer_size: u32) -> Vec<f32> {
    if buffer_size <= 1 {
        return values.to_vec();
    }
    let window = buffer_size as usize;
    let half = window / 2;
    (0..values.len())
        .map(|index| {
            let start = index.saturating_sub(half);
            let end = (index + half + 1).min(values.len());
            smooth_angle(&values[start..end])
        })
        .collect()
}

/// 对逐帧姿态序列做时序平滑。
///
/// * 每个关节点只在窗口内的**高置信度**样本上做加权平均；
/// * 目标帧自身不是高置信度时保持原样——补点交给 `build_animation`
///   里的基准帧传播去做，避免把轨迹拉向原点；
/// * 窗口内完全没有高置信度样本时也保留原值；
/// * `bufferSize<=1` 时等价于不平滑。
pub fn smooth_poses(frames: &[Vec<Pose2D>], cfg: &SmoothConfig) -> Vec<Vec<Pose2D>> {
    if cfg.buffer_size <= 1 || frames.is_empty() {
        return frames.to_vec();
    }
    let window = cfg.buffer_size as usize;
    let half = window / 2;
    let num_parts = frames
        .iter()
        .flat_map(|frame| frame.iter())
        .map(|pose| pose.keypoints.len())
        .max()
        .unwrap_or(0);
    if num_parts == 0 {
        return frames.to_vec();
    }

    let mut output = frames.to_vec();
    for (frame_index, frame) in frames.iter().enumerate() {
        let start = frame_index.saturating_sub(half);
        let end = (frame_index + half + 1).min(frames.len());
        for (pose_index, _pose) in frame.iter().enumerate() {
            for part in 0..num_parts {
                // 目标帧自己就不可信时不参与平滑，交给传播阶段处理
                let target_score = output
                    .get(frame_index)
                    .and_then(|frame| frame.get(pose_index))
                    .and_then(|pose| pose.keypoints.get(part))
                    .map(|keypoint| keypoint.score)
                    .unwrap_or(0.0);
                if target_score < cfg.confidence_threshold {
                    continue;
                }
                let mut weight_sum = 0.0f32;
                let (mut x_sum, mut y_sum) = (0.0f32, 0.0f32);
                for neighbour in &frames[start..end] {
                    // 同一下标的人形在时间上前后对应（原版也只处理单/少人场景）
                    let Some(source) = neighbour.get(pose_index) else {
                        continue;
                    };
                    let Some(keypoint) = source.keypoints.get(part) else {
                        continue;
                    };
                    if keypoint.score < cfg.confidence_threshold {
                        continue;
                    }
                    let weight = keypoint.score;
                    x_sum += keypoint.x * weight;
                    y_sum += keypoint.y * weight;
                    weight_sum += weight;
                }
                if weight_sum > 0.0 {
                    if let Some(target) = output
                        .get_mut(frame_index)
                        .and_then(|f| f.get_mut(pose_index))
                        .and_then(|p| p.keypoints.get_mut(part))
                    {
                        *target = Keypoint::new(x_sum / weight_sum, y_sum / weight_sum, target.score);
                    }
                }
            }
        }
    }
    output
}
