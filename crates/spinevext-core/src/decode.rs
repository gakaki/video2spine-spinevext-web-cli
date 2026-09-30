//! PoseNet 输出解码。
//!
//! 对应原版 `PoseNetPoseEstimator.DecodeSinglePose` / `DecodeMultiplePoses`：
//! 1. 对每个关节点在 heatmap 上取最大值位置，置信度是 `sigmoid(heatmap)`
//! 2. 用同位置的 offsets 修正到亚像素精度
//! 3. 多人模式下按分数贪心取根节点，再用位移把同一人的关节点聚成一个人
//! 4. 用 NMS 半径把已被占用的人体框附近的候选点剔除

use crate::types::{
    part, DecodeConfig, Keypoint, OffsetOrder, Pose2D, TensorLayout, KEYPOINT_NAMES,
};

/// COCO 骨架的父子边，与 TF PoseNet 的 `parentChildrenTuples` 完全一致。
pub const PARENT_CHILD_EDGES: [(usize, usize); 16] = [
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
    (0, 5),
    (0, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (11, 13),
    (13, 15),
    (6, 12),
    (12, 14),
    (14, 16),
];

/// 一个带排布信息的张量视图，避免在热路径里反复算下标。
struct TensorView<'a> {
    data: &'a [f32],
    height: usize,
    width: usize,
    channels: usize,
    layout: TensorLayout,
}

impl<'a> TensorView<'a> {
    fn new(
        data: &'a [f32],
        height: usize,
        width: usize,
        channels: usize,
        layout: TensorLayout,
    ) -> Self {
        Self {
            data,
            height,
            width,
            channels,
            layout,
        }
    }

    /// 读取 `(y, x, channel)`，越界返回 0，方便模型缺输出时静默退化成单人解码。
    #[inline]
    fn at(&self, y: usize, x: usize, channel: usize) -> f32 {
        if y >= self.height || x >= self.width || channel >= self.channels {
            return 0.0;
        }
        let index = match self.layout {
            TensorLayout::Nhwc => (y * self.width + x) * self.channels + channel,
            TensorLayout::Nchw => channel * self.height * self.width + y * self.width + x,
        };
        self.data.get(index).copied().unwrap_or(0.0)
    }

    fn is_empty(&self) -> bool {
        self.data.is_empty() || self.channels == 0
    }
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

fn offset_pair(view: &TensorView, y: usize, x: usize, part_index: usize, order: OffsetOrder) -> (f32, f32) {
    let a = view.at(y, x, part_index * 2);
    let b = view.at(y, x, part_index * 2 + 1);
    match order {
        OffsetOrder::Yx => (b, a), // (dy, dx) -> (dx, dy)
        OffsetOrder::Xy => (a, b),
    }
}

/// heatmap 上某个关节点最大值的位置。
struct Peak {
    heatmap_x: usize,
    heatmap_y: usize,
    score: f32,
}

fn find_peak(view: &TensorView, part_index: usize) -> Peak {
    let mut best = Peak {
        heatmap_x: 0,
        heatmap_y: 0,
        score: f32::NEG_INFINITY,
    };
    for y in 0..view.height {
        for x in 0..view.width {
            let value = view.at(y, x, part_index);
            if value > best.score {
                best = Peak {
                    heatmap_x: x,
                    heatmap_y: y,
                    score: value,
                };
            }
        }
    }
    if best.score == f32::NEG_INFINITY {
        best.score = 0.0;
    }
    best
}

/// 把 heatmap 单元坐标 + offsets 换算成模型输入空间的像素坐标。
fn image_coords(
    peak: &Peak,
    offsets: &TensorView,
    part_index: usize,
    cfg: &DecodeConfig,
) -> (f32, f32) {
    let (dx, dy) = offset_pair(offsets, peak.heatmap_y, peak.heatmap_x, part_index, cfg.offset_order);
    let multiplier = if cfg.offset_in_pixels {
        1.0
    } else {
        cfg.stride as f32
    };
    let x = peak.heatmap_x as f32 * cfg.stride as f32 + dx * multiplier;
    let y = peak.heatmap_y as f32 * cfg.stride as f32 + dy * multiplier;
    cfg.transform.to_source(x, y)
}

/// 单人解码：每个关节点各取全局最大值，直接拼成一个人。
pub fn decode_single_pose(
    heatmaps: &[f32],
    offsets: &[f32],
    heatmap_h: usize,
    heatmap_w: usize,
    num_parts: usize,
    cfg: &DecodeConfig,
) -> Pose2D {
    let heatmap_view = TensorView::new(
        heatmaps,
        heatmap_h,
        heatmap_w,
        num_parts,
        cfg.heatmap_layout,
    );
    let offset_view = TensorView::new(
        offsets,
        heatmap_h,
        heatmap_w,
        num_parts * 2,
        cfg.offset_layout,
    );

    let mut pose = Pose2D::empty(num_parts);
    let mut total = 0.0;
    for part_index in 0..num_parts {
        let peak = find_peak(&heatmap_view, part_index);
        let score = sigmoid(peak.score);
        let (x, y) = if heatmap_view.is_empty() {
            (0.0, 0.0)
        } else {
            image_coords(&peak, &offset_view, part_index, cfg)
        };
        pose.keypoints[part_index] = Keypoint::new(x, y, score);
        total += score;
    }
    pose.score = if num_parts == 0 {
        0.0
    } else {
        total / num_parts as f32
    };
    pose
}

/// 多人解码用的候选关节点。
#[derive(Clone, Copy, Debug)]
struct Candidate {
    part_id: usize,
    heatmap_x: usize,
    heatmap_y: usize,
    score: f32,
    x: f32,
    y: f32,
}

fn edge_between(parent: usize, child: usize) -> Option<usize> {
    PARENT_CHILD_EDGES
        .iter()
        .position(|&(p, c)| p == parent && c == child)
}

/// 读取位移张量：返回把 `(y, x)` 朝目标部件推近后的位置。
fn displaced_position(
    view: &TensorView,
    y: usize,
    x: usize,
    edge: usize,
) -> (f32, f32) {
    let dy = view.at(y, x, edge * 2);
    let dx = view.at(y, x, edge * 2 + 1);
    (x as f32 + dx, y as f32 + dy)
}

/// 多人解码：对应原版 `DecodeMultiplePoses`。
///
/// `displacements_fwd` / `displacements_bwd` 允许为空切片；为空时退化成
/// 「直接比较欧氏距离」的简化聚合，仍然能得到合理结果。
pub fn decode_multiple_poses(
    heatmaps: &[f32],
    offsets: &[f32],
    displacements_fwd: &[f32],
    displacements_bwd: &[f32],
    heatmap_h: usize,
    heatmap_w: usize,
    num_parts: usize,
    cfg: &DecodeConfig,
) -> Vec<Pose2D> {
    let heatmap_view = TensorView::new(
        heatmaps,
        heatmap_h,
        heatmap_w,
        num_parts,
        cfg.heatmap_layout,
    );
    if heatmap_view.is_empty() || num_parts == 0 {
        return Vec::new();
    }
    let offset_view = TensorView::new(
        offsets,
        heatmap_h,
        heatmap_w,
        num_parts * 2,
        cfg.offset_layout,
    );
    let fwd_view = TensorView::new(
        displacements_fwd,
        heatmap_h,
        heatmap_w,
        PARENT_CHILD_EDGES.len() * 2,
        cfg.displacement_layout,
    );
    let bwd_view = TensorView::new(
        displacements_bwd,
        heatmap_h,
        heatmap_w,
        PARENT_CHILD_EDGES.len() * 2,
        cfg.displacement_layout,
    );

    let mut candidates: Vec<Candidate> = Vec::new();
    for part_index in 0..num_parts {
        for y in 0..heatmap_h {
            for x in 0..heatmap_w {
                let raw = heatmap_view.at(y, x, part_index);
                let score = sigmoid(raw);
                if score < cfg.confidence_threshold {
                    continue;
                }
                let peak = Peak {
                    heatmap_x: x,
                    heatmap_y: y,
                    score: raw,
                };
                let (px, py) = image_coords(&peak, &offset_view, part_index, cfg);
                candidates.push(Candidate {
                    part_id: part_index,
                    heatmap_x: x,
                    heatmap_y: y,
                    score,
                    x: px,
                    y: py,
                });
            }
        }
    }
    candidates.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let max_poses = cfg.max_poses.max(1) as usize;
    let squared_nms_radius = cfg.nms_radius * cfg.nms_radius;
    let mut poses: Vec<Pose2D> = Vec::new();

    while poses.len() < max_poses && !candidates.is_empty() {
        let root = candidates.remove(0);
        let mut chosen: Vec<Option<Candidate>> = vec![None; num_parts];
        chosen[root.part_id] = Some(root);

        for part_index in 0..num_parts {
            if chosen[part_index].is_some() {
                continue;
            }
            // 如果该部件与根节点直接相连，就先用位移把根节点推到预期位置，
            // 这样多人场景里不会把别人的手接到这个人身上。
            let anchor = if let Some(edge) = edge_between(root.part_id, part_index) {
                if fwd_view.is_empty() {
                    (root.x, root.y)
                } else {
                    let (mx, my) =
                        displaced_position(&fwd_view, root.heatmap_y, root.heatmap_x, edge);
                    cfg.transform.to_source(
                        mx * cfg.stride as f32,
                        my * cfg.stride as f32,
                    )
                }
            } else if let Some(edge) = edge_between(part_index, root.part_id) {
                if bwd_view.is_empty() {
                    (root.x, root.y)
                } else {
                    let (mx, my) =
                        displaced_position(&bwd_view, root.heatmap_y, root.heatmap_x, edge);
                    cfg.transform.to_source(
                        mx * cfg.stride as f32,
                        my * cfg.stride as f32,
                    )
                }
            } else {
                (root.x, root.y)
            };

            let mut best: Option<(f32, usize)> = None;
            for (index, candidate) in candidates.iter().enumerate() {
                if candidate.part_id != part_index {
                    continue;
                }
                let dx = candidate.x - anchor.0;
                let dy = candidate.y - anchor.1;
                let distance = dx * dx + dy * dy;
                if best.map(|(d, _)| distance < d).unwrap_or(true) {
                    best = Some((distance, index));
                }
            }
            if let Some((_, index)) = best {
                chosen[part_index] = Some(candidates.remove(index));
            }
        }

        let found = chosen.iter().flatten().count();
        if found == 0 {
            break;
        }
        let mean_score: f32 =
            chosen.iter().flatten().map(|c| c.score).sum::<f32>() / found as f32;
        let mut pose = Pose2D::empty(num_parts);
        for (index, candidate) in chosen.iter().enumerate() {
            if let Some(candidate) = candidate {
                pose.keypoints[index] = Keypoint::new(candidate.x, candidate.y, candidate.score);
            }
        }
        pose.score = mean_score * root.score;
        poses.push(pose);

        // NMS：把离本次根节点太近的候选点全部剔除，避免同一人被反复检出。
        candidates.retain(|c| {
            let dx = c.x - root.x;
            let dy = c.y - root.y;
            dx * dx + dy * dy > squared_nms_radius
        });
        // 同一个部件已经分配过的候选点也不再参与后续人形。
        candidates.retain(|c| {
            chosen
                .iter()
                .flatten()
                .all(|used| used.part_id != c.part_id || !same_point(used, c))
        });
    }

    poses
}

fn same_point(a: &Candidate, b: &Candidate) -> bool {
    a.heatmap_x == b.heatmap_x && a.heatmap_y == b.heatmap_y
}

/// 统一的解码入口：按 `cfg.multi_pose` 选择单人或多人路径。
pub fn decode(
    heatmaps: &[f32],
    offsets: &[f32],
    displacements_fwd: &[f32],
    displacements_bwd: &[f32],
    heatmap_h: usize,
    heatmap_w: usize,
    num_parts: usize,
    cfg: &DecodeConfig,
) -> Vec<Pose2D> {
    if cfg.multi_pose {
        decode_multiple_poses(
            heatmaps,
            offsets,
            displacements_fwd,
            displacements_bwd,
            heatmap_h,
            heatmap_w,
            num_parts,
            cfg,
        )
    } else {
        vec![decode_single_pose(
            heatmaps,
            offsets,
            heatmap_h,
            heatmap_w,
            num_parts,
            cfg,
        )]
    }
}

/// 便捷函数：返回 COCO-17 的关节点名字，供 UI 与测试使用。
pub fn keypoint_names() -> Vec<String> {
    KEYPOINT_NAMES.iter().map(|name| name.to_string()).collect()
}

/// 直接回归型姿态模型的解码（MoveNet / SinglePose 系列）。
///
/// 这类模型不输出 heatmap，而是直接给出 `[1, 1, num_parts, 3]` 的张量，
/// 每个关节点三个值分别是 **归一化 y、归一化 x、置信度**。
/// 先用模型输入尺寸还原成模型空间像素，再用 letterbox 变换映射回源图，
/// 就得到与 PoseNet 解码完全一致的 [`Pose2D`]，
/// 后续的平滑 / 骨骼 / 导出流程可以直接复用。
pub fn decode_regression(
    values: &[f32],
    num_parts: usize,
    model_width: u32,
    model_height: u32,
    transform: &crate::types::ImageTransform,
) -> Pose2D {
    let mut pose = Pose2D::empty(num_parts);
    let mut total = 0.0f32;
    for part_index in 0..num_parts {
        let base = part_index * 3;
        if base + 2 >= values.len() {
            continue;
        }
        let y = values[base];
        let x = values[base + 1];
        let score = values[base + 2];
        let (sx, sy) = transform.to_source(x * model_width as f32, y * model_height as f32);
        pose.keypoints[part_index] = Keypoint::new(sx, sy, score);
        total += score;
    }
    pose.score = if num_parts == 0 {
        0.0
    } else {
        total / num_parts as f32
    };
    pose
}

/// 判断某个关节点是否是「左侧」，用于左右镜像处理。
pub fn is_left_part(index: usize) -> bool {
    matches!(
        index,
        part::LEFT_EYE
            | part::LEFT_EAR
            | part::LEFT_SHOULDER
            | part::LEFT_ELBOW
            | part::LEFT_WRIST
            | part::LEFT_HIP
            | part::LEFT_KNEE
            | part::LEFT_ANKLE
    )
}
