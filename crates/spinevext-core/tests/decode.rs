use spinevext_core::decode::decode;
use spinevext_core::types::{DecodeConfig, ImageTransform, OffsetOrder, TensorLayout};

const NUM_PARTS: usize = 17;

/// 构造一份 NHWC heatmap，并把指定关节点在指定单元上打成峰值。
fn heatmap_with_peaks(height: usize, width: usize, peaks: &[(usize, usize, usize, f32)]) -> Vec<f32> {
    let mut data = vec![0.0f32; height * width * NUM_PARTS];
    for &(part, y, x, value) in peaks {
        data[(y * width + x) * NUM_PARTS + part] = value;
    }
    data
}

fn single_pose_config() -> DecodeConfig {
    DecodeConfig {
        confidence_threshold: 0.3,
        nms_radius: 20.0,
        max_poses: 4,
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

#[test]
fn single_pose_peak_maps_back_to_pixels() {
    let heatmaps = heatmap_with_peaks(2, 2, &[(0, 0, 1, 2.0)]);
    let offsets = vec![0.0f32; 2 * 2 * NUM_PARTS * 2];

    let poses = decode(&heatmaps, &offsets, &[], &[], 2, 2, NUM_PARTS, &single_pose_config());

    assert_eq!(poses.len(), 1);
    let nose = poses[0].keypoints[0];
    assert!((nose.x - 16.0).abs() < 1e-4, "x 应为 1 * stride = 16");
    assert!(nose.y.abs() < 1e-4);
    let expected = 1.0 / (1.0 + (-2.0f32).exp());
    assert!((nose.score - expected).abs() < 1e-5, "置信度应为 sigmoid(2.0)");
}

#[test]
fn offsets_refine_the_peak_position() {
    let heatmaps = heatmap_with_peaks(2, 2, &[(0, 0, 1, 2.0)]);
    let mut offsets = vec![0.0f32; 2 * 2 * NUM_PARTS * 2];
    // TF 的通道顺序是 (dy, dx)，这里给鼻子加 (+1, +2)
    offsets[(0 * 2 + 1) * NUM_PARTS * 2 + 0] = 1.0;
    offsets[(0 * 2 + 1) * NUM_PARTS * 2 + 1] = 2.0;

    let poses = decode(&heatmaps, &offsets, &[], &[], 2, 2, NUM_PARTS, &single_pose_config());
    let nose = poses[0].keypoints[0];
    assert!((nose.x - 18.0).abs() < 1e-4, "x 应为 16 + 2");
    assert!((nose.y - 1.0).abs() < 1e-4, "y 应为 0 + 1");
}

#[test]
fn transform_maps_back_to_source_coordinates() {
    let mut cfg = single_pose_config();
    // 源图是模型输入的两倍，且纵向偏移 10
    cfg.transform = ImageTransform {
        scale: 2.0,
        offset_x: 0.0,
        offset_y: 10.0,
    };
    let heatmaps = heatmap_with_peaks(2, 2, &[(0, 0, 1, 2.0)]);
    let offsets = vec![0.0f32; 2 * 2 * NUM_PARTS * 2];

    let poses = decode(&heatmaps, &offsets, &[], &[], 2, 2, NUM_PARTS, &cfg);
    let nose = poses[0].keypoints[0];
    assert!((nose.x - 8.0).abs() < 1e-4, "16 / 2 = 8");
    assert!((nose.y - (-5.0)).abs() < 1e-4, "(0 - 10) / 2 = -5");
}

#[test]
fn multi_pose_splits_peaks_beyond_nms_radius() {
    let mut cfg = single_pose_config();
    cfg.multi_pose = true;
    cfg.nms_radius = 5.0;

    // 两个鼻子峰，相距 10 个模型像素（stride=16 → 单元 0 与单元 1 相距 16）
    let heatmaps = heatmap_with_peaks(1, 2, &[(0, 0, 0, 2.0), (0, 0, 1, 1.5)]);
    let offsets = vec![0.0f32; 1 * 2 * NUM_PARTS * 2];
    let poses = decode(&heatmaps, &offsets, &[], &[], 2, 1, NUM_PARTS, &cfg);
    assert_eq!(poses.len(), 2, "距离大于 NMS 半径时应保留两个人形");
    assert!(poses[0].score >= poses[1].score, "第一个人形应是高分那个");
}

#[test]
fn multi_pose_merges_peaks_within_nms_radius() {
    let mut cfg = single_pose_config();
    cfg.multi_pose = true;
    cfg.nms_radius = 40.0;

    let heatmaps = heatmap_with_peaks(1, 2, &[(0, 0, 0, 2.0), (0, 0, 1, 1.5)]);
    let offsets = vec![0.0f32; 1 * 2 * NUM_PARTS * 2];
    let poses = decode(&heatmaps, &offsets, &[], &[], 2, 1, NUM_PARTS, &cfg);
    assert_eq!(poses.len(), 1, "距离小于 NMS 半径时应合并成一个人形");
}

#[test]
fn low_confidence_peaks_are_filtered_out() {
    let mut cfg = single_pose_config();
    cfg.multi_pose = true;
    // 峰值 0 → sigmoid(0) = 0.5；阈值设成 0.5 以上就全被滤掉
    cfg.confidence_threshold = 0.6;
    let heatmaps = heatmap_with_peaks(2, 2, &[(0, 0, 0, 0.0)]);
    let offsets = vec![0.0f32; 2 * 2 * NUM_PARTS * 2];
    let poses = decode(&heatmaps, &offsets, &[], &[], 2, 2, NUM_PARTS, &cfg);
    assert!(poses.is_empty());
}
