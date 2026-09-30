use spinevext_core::smooth::{clamp_angle, smooth_angle_series, smooth_poses};
use spinevext_core::types::{Keypoint, Pose2D, SmoothConfig};

#[test]
fn angle_smoothing_crosses_the_pi_boundary() {
    let values = [179.0f32, -179.0, 178.0];
    let smoothed = smooth_angle_series(&values, 3);
    assert_eq!(smoothed.len(), 3);
    for (index, value) in smoothed.iter().enumerate() {
        assert!(
            value.abs() > 170.0,
            "第 {index} 个值应接近 ±180°，说明跨边界没有被拉向 0°，实际 {value}"
        );
    }
}

#[test]
fn buffer_size_one_is_a_no_op() {
    let values = [10.0f32, -20.0, 30.0, 179.0];
    assert_eq!(smooth_angle_series(&values, 1), values.to_vec());
}

#[test]
fn clamp_angle_wraps_into_signed_range() {
    assert!((clamp_angle(190.0) - (-170.0)).abs() < 1e-4);
    assert!((clamp_angle(-190.0) - 170.0).abs() < 1e-4);
    assert!((clamp_angle(45.0) - 45.0).abs() < 1e-4);
}

fn pose_at(x: f32, y: f32, score: f32) -> Pose2D {
    Pose2D {
        score,
        keypoints: vec![Keypoint::new(x, y, score)],
    }
}

#[test]
fn poses_are_smoothed_per_keypoint() {
    let frames = vec![
        vec![pose_at(0.0, 0.0, 0.9)],
        vec![pose_at(10.0, 0.0, 0.9)],
        vec![pose_at(20.0, 0.0, 0.9)],
    ];
    let cfg = SmoothConfig {
        buffer_size: 3,
        confidence_threshold: 0.3,
    };
    let smoothed = smooth_poses(&frames, &cfg);
    assert!((smoothed[0][0].keypoints[0].x - 5.0).abs() < 1e-4);
    assert!((smoothed[1][0].keypoints[0].x - 10.0).abs() < 1e-4);
    assert!((smoothed[2][0].keypoints[0].x - 15.0).abs() < 1e-4);
}

#[test]
fn low_confidence_neighbours_do_not_drag_the_track() {
    let frames = vec![
        vec![pose_at(100.0, 50.0, 0.9)],
        vec![pose_at(0.0, 0.0, 0.01)],
        vec![pose_at(100.0, 50.0, 0.9)],
    ];
    let cfg = SmoothConfig {
        buffer_size: 3,
        confidence_threshold: 0.3,
    };
    let smoothed = smooth_poses(&frames, &cfg);
    assert!((smoothed[0][0].keypoints[0].x - 100.0).abs() < 1e-4);
    assert!((smoothed[1][0].keypoints[0].x - 0.0).abs() < 1e-4, "中间帧自身不可信时保留原值");
}
