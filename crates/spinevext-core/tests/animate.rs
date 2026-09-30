use spinevext_core::animate::{build_animation, pick_base_frame, AnimConfig};
use spinevext_core::rig::{BoneFrame, RigConfig, BONE_NAMES};
use spinevext_core::types::{part, Keypoint, Pose2D};

fn frame_with(rotation: f32, confidence: f32, valid: bool) -> BoneFrame {
    let mut rotations = vec![0.0f32; BONE_NAMES.len()];
    rotations[2] = rotation;
    BoneFrame {
        rotations,
        confidence,
        valid,
    }
}

fn standing_pose() -> Pose2D {
    let mut keypoints = vec![Keypoint::default(); 17];
    let mut set = |index: usize, x: f32, y: f32| {
        keypoints[index] = Keypoint::new(x, y, 0.9);
    };
    set(part::NOSE, 100.0, 50.0);
    set(part::LEFT_SHOULDER, 90.0, 100.0);
    set(part::RIGHT_SHOULDER, 110.0, 100.0);
    set(part::LEFT_ELBOW, 80.0, 140.0);
    set(part::RIGHT_ELBOW, 120.0, 140.0);
    set(part::LEFT_WRIST, 75.0, 180.0);
    set(part::RIGHT_WRIST, 125.0, 180.0);
    set(part::LEFT_HIP, 95.0, 170.0);
    set(part::RIGHT_HIP, 105.0, 170.0);
    set(part::LEFT_KNEE, 95.0, 240.0);
    set(part::RIGHT_KNEE, 105.0, 240.0);
    set(part::LEFT_ANKLE, 95.0, 300.0);
    set(part::RIGHT_ANKLE, 105.0, 300.0);
    Pose2D {
        score: 0.9,
        keypoints,
    }
}

#[test]
fn base_frame_prefers_valid_and_confident_frames() {
    let bones = vec![
        frame_with(10.0, 0.9, true),
        frame_with(20.0, 0.95, false),
        frame_with(30.0, 0.85, true),
    ];
    assert_eq!(pick_base_frame(&bones), 0);
}

#[test]
fn invalid_frames_are_propagated_from_the_base_frame() {
    let bones = vec![
        frame_with(10.0, 0.9, true),
        frame_with(99.0, 0.05, false),
        frame_with(30.0, 0.8, true),
    ];
    let poses = vec![vec![standing_pose()], vec![], vec![standing_pose()]];
    let data = build_animation(
        &bones,
        &poses,
        &AnimConfig::default(),
        &RigConfig::default(),
        360.0,
    );
    assert_eq!(data.base_frame, 0, "自动基准帧应选到最完整的第一帧");
    assert_eq!(data.frames[1][2], data.frames[0][2], "无效帧应被基准帧覆盖");
    assert_eq!(data.frames[2][2], 30.0, "有效帧保持自己的角度");
    assert_eq!(data.validity, vec![true, false, true]);
}

#[test]
fn explicit_base_frame_overrides_auto_pick() {
    let bones = vec![
        frame_with(10.0, 0.9, true),
        frame_with(30.0, 0.8, true),
    ];
    let poses = vec![vec![standing_pose()], vec![standing_pose()]];
    let cfg = AnimConfig {
        base_frame: 1,
        ..AnimConfig::default()
    };
    let data = build_animation(&bones, &poses, &cfg, &RigConfig::default(), 360.0);
    assert_eq!(data.base_frame, 1);
    assert_eq!(data.frames[1][2], 30.0);
}

#[test]
fn skeleton_lengths_come_from_the_base_frame() {
    let bones = vec![frame_with(10.0, 0.9, true)];
    let poses = vec![vec![standing_pose()]];
    let data = build_animation(
        &bones,
        &poses,
        &AnimConfig::default(),
        &RigConfig::default(),
        360.0,
    );
    let torso = data
        .skeleton
        .iter()
        .find(|bone| bone.name == "torso")
        .expect("应存在 torso 骨骼");
    assert!(torso.length > 0.0, "躯干长度应来自基准帧的髋-颈距离");
    assert_eq!(torso.parent.as_deref(), Some("hip"));
    let root = &data.skeleton[0];
    assert_eq!(root.name, "root");
    assert!(root.parent.is_none());
}
