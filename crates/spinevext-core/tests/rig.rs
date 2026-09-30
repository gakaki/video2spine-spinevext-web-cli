use spinevext_core::rig::{absolute_angles, bone, poses_to_bones, RigConfig, BONE_NAMES};
use spinevext_core::types::{part, Keypoint, Pose2D};

const IMAGE_HEIGHT: f32 = 300.0;

/// 构造一个标准 T-pose：双臂水平、双腿垂直向下。
fn t_pose() -> Pose2D {
    let mut keypoints = vec![Keypoint::default(); 17];
    let mut set = |index: usize, x: f32, y: f32| {
        keypoints[index] = Keypoint::new(x, y, 0.9);
    };
    set(part::NOSE, 100.0, 50.0);
    set(part::LEFT_EYE, 95.0, 45.0);
    set(part::RIGHT_EYE, 105.0, 45.0);
    set(part::LEFT_EAR, 90.0, 48.0);
    set(part::RIGHT_EAR, 110.0, 48.0);
    set(part::LEFT_SHOULDER, 80.0, 100.0);
    set(part::RIGHT_SHOULDER, 120.0, 100.0);
    set(part::LEFT_ELBOW, 60.0, 100.0);
    set(part::RIGHT_ELBOW, 140.0, 100.0);
    set(part::LEFT_WRIST, 40.0, 100.0);
    set(part::RIGHT_WRIST, 160.0, 100.0);
    set(part::LEFT_HIP, 90.0, 150.0);
    set(part::RIGHT_HIP, 110.0, 150.0);
    set(part::LEFT_KNEE, 90.0, 200.0);
    set(part::RIGHT_KNEE, 110.0, 200.0);
    set(part::LEFT_ANKLE, 90.0, 250.0);
    set(part::RIGHT_ANKLE, 110.0, 250.0);
    Pose2D {
        score: 0.9,
        keypoints,
    }
}

#[test]
fn t_pose_produces_upright_torso_and_horizontal_arms() {
    let angles = absolute_angles(&t_pose(), &RigConfig::default(), IMAGE_HEIGHT);
    let torso = angles[bone::TORSO].expect("躯干角度应可用");
    assert!((torso - 90.0).abs() < 1e-3, "视频坐标翻到 y 向上后躯干应朝上 (90°)，实际 {torso}");

    let arm_left = angles[bone::UPPER_ARM_L].expect("左大臂角度应可用");
    let arm_right = angles[bone::UPPER_ARM_R].expect("右大臂角度应可用");
    assert!((arm_left - 180.0).abs() < 1e-3, "左臂应指向屏幕左侧 (180°)，实际 {arm_left}");
    assert!(arm_right.abs() < 1e-3, "右臂应指向屏幕右侧 (0°)，实际 {arm_right}");

    let leg_left = angles[bone::UPPER_LEG_L].expect("左大腿角度应可用");
    let leg_right = angles[bone::UPPER_LEG_R].expect("右大腿角度应可用");
    assert!((leg_left + 90.0).abs() < 1e-3, "左腿应朝下 (-90°)，实际 {leg_left}");
    assert!((leg_right + 90.0).abs() < 1e-3, "右腿应朝下 (-90°)，实际 {leg_right}");
}

#[test]
fn local_rotations_are_relative_to_parents() {
    let frames = vec![vec![t_pose()]];
    let bones = poses_to_bones(&frames, &RigConfig::default(), IMAGE_HEIGHT);
    assert_eq!(bones.len(), 1);
    let frame = &bones[0];
    assert_eq!(frame.rotations.len(), BONE_NAMES.len());
    assert!(frame.valid, "T-pose 的全部关节点都高置信度，应判定为有效帧");

    let upper_left = frame.rotations[bone::UPPER_ARM_L];
    let upper_right = frame.rotations[bone::UPPER_ARM_R];
    assert!((upper_left - 90.0).abs() < 1e-3, "左大臂相对躯干应为 +90°，实际 {upper_left}");
    assert!((upper_right + 90.0).abs() < 1e-3, "右大臂相对躯干应为 -90°，实际 {upper_right}");
    assert!(upper_left * upper_right < 0.0, "左右大臂局部角符号应相反");

    // hip 是世界对齐的骨盆，所以站姿时 torso 的局部角就是躯干绝对角 90°
    let hip_local = frame.rotations[bone::HIP];
    let torso_local = frame.rotations[bone::TORSO];
    assert!(hip_local.abs() < 1e-3, "骨盆不旋转，实际 {hip_local}");
    assert!((torso_local - 90.0).abs() < 1e-3, "站姿躯干应相对骨盆抬起 90°，实际 {torso_local}");
}

#[test]
fn missing_keypoints_fall_back_without_nan() {
    let pose = Pose2D::default(); // 全部 confidence = 0
    let frames = vec![vec![pose]];
    let bones = poses_to_bones(&frames, &RigConfig::default(), IMAGE_HEIGHT);
    assert!(!bones[0].valid);
    assert!(bones[0].rotations.iter().all(|value| value.is_finite()));
}

#[test]
fn swapped_pose_swaps_arm_angles() {
    // 把左右手臂数据互换，角度也应互换——说明骨骼确实按解剖学左右命名
    let mut pose = t_pose();
    let left_shoulder = pose.keypoints[part::LEFT_SHOULDER];
    let right_shoulder = pose.keypoints[part::RIGHT_SHOULDER];
    pose.keypoints[part::LEFT_SHOULDER] = right_shoulder;
    pose.keypoints[part::RIGHT_SHOULDER] = left_shoulder;
    let left_elbow = pose.keypoints[part::LEFT_ELBOW];
    let right_elbow = pose.keypoints[part::RIGHT_ELBOW];
    pose.keypoints[part::LEFT_ELBOW] = right_elbow;
    pose.keypoints[part::RIGHT_ELBOW] = left_elbow;

    let angles = absolute_angles(&pose, &RigConfig::default(), IMAGE_HEIGHT);
    let arm_left = angles[bone::UPPER_ARM_L].expect("左臂角度应可用");
    let arm_right = angles[bone::UPPER_ARM_R].expect("右臂角度应可用");
    // 互换后左臂拿到了原本右臂的坐标 (120→140)，方向变成朝右
    assert!(arm_left.abs() < 1e-3, "互换后左臂应朝屏幕右侧，实际 {arm_left}");
    assert!((arm_right.abs() - 180.0).abs() < 1e-3, "互换后右臂应朝屏幕左侧，实际 {arm_right}");
}
