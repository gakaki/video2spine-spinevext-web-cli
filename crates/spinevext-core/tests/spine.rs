use serde_json::Value;
use spinevext_core::animate::{build_animation, AnimConfig};
use spinevext_core::rig::{BoneFrame, RigConfig, BONE_NAMES};
use spinevext_core::spine::{build_spine_json, region_name, ExportConfig};
use spinevext_core::types::{part, Keypoint, Pose2D};

fn pose() -> Pose2D {
    let mut keypoints = vec![Keypoint::default(); 17];
    let mut set = |index: usize, x: f32, y: f32| {
        keypoints[index] = Keypoint::new(x, y, 0.9);
    };
    set(part::NOSE, 320.0, 100.0);
    set(part::LEFT_SHOULDER, 280.0, 220.0);
    set(part::RIGHT_SHOULDER, 360.0, 220.0);
    set(part::LEFT_ELBOW, 250.0, 300.0);
    set(part::RIGHT_ELBOW, 390.0, 300.0);
    set(part::LEFT_WRIST, 230.0, 380.0);
    set(part::RIGHT_WRIST, 410.0, 380.0);
    set(part::LEFT_HIP, 300.0, 400.0);
    set(part::RIGHT_HIP, 340.0, 400.0);
    set(part::LEFT_KNEE, 300.0, 550.0);
    set(part::RIGHT_KNEE, 340.0, 550.0);
    set(part::LEFT_ANKLE, 300.0, 700.0);
    set(part::RIGHT_ANKLE, 340.0, 700.0);
    Pose2D {
        score: 0.9,
        keypoints,
    }
}

fn two_frame_animation() -> spinevext_core::animate::AnimationData {
    let bones = vec![
        BoneFrame {
            rotations: vec![5.0; BONE_NAMES.len()],
            confidence: 0.9,
            valid: true,
        },
        BoneFrame {
            rotations: vec![15.0; BONE_NAMES.len()],
            confidence: 0.9,
            valid: true,
        },
    ];
    let poses = vec![vec![pose()], vec![pose()]];
    build_animation(&bones, &poses, &AnimConfig::default(), &RigConfig::default(), 720.0)
}

#[test]
fn json_round_trips_with_expected_structure() {
    let anim = two_frame_animation();
    let cfg = ExportConfig {
        name: "demo".to_string(),
        animation_name: "walk".to_string(),
        frame_width: 640.0,
        frame_height: 720.0,
        frame_count: 2,
        fps: 30.0,
        region_prefix: "frame_".to_string(),
        image_name: "demo.png".to_string(),
        image_scale: 1.0,
    };

    let text = build_spine_json(&anim, &cfg).expect("导出应成功");
    let json: Value = serde_json::from_str(&text).expect("导出的 JSON 必须可被解析");

    // 导出的格式版本在这里锁死；TS 侧读同一份（`engine.spineVersion`）
    assert_eq!(json["skeleton"]["spine"], "4.3.23");
    assert_eq!(json["skeleton"]["width"], 640.0);
    assert_eq!(json["slots"][0]["name"], "video");
    assert_eq!(json["slots"][0]["bone"], "root");

    let attachments = json["animations"]["walk"]["slots"]["video"]["attachment"]
        .as_array()
        .expect("attachment 时间轴应为数组");
    // 2 帧 + 1 个回到首帧的循环关键帧
    assert_eq!(attachments.len(), 3);
    assert_eq!(attachments[0]["name"], region_name("frame_", 0));
    let second_time = attachments[1]["time"].as_f64().expect("time 应为数字");
    assert!((second_time - 1.0 / 30.0).abs() < 1e-6, "第 2 帧时间应为 1/30 秒");

    let rotate = json["animations"]["walk"]["bones"]["torso"]["rotate"]
        .as_array()
        .expect("torso 应有 rotate 时间轴");
    assert_eq!(rotate.len(), 2);
    // Spine 4.x 的 rotate 时间轴用 `value` 表示角度
    assert_eq!(rotate[1]["value"], 15.0);

    // Spine 4.x 的 skins 是数组：`[{ name, attachments }]`
    assert_eq!(json["skins"][0]["name"], "default");
    let skin = &json["skins"][0]["attachments"]["video"];
    assert_eq!(skin[&region_name("frame_", 1)]["width"], 640.0);
    assert_eq!(skin[&region_name("frame_", 1)]["height"], 720.0);
    // 附件必须显式声明类型，否则 4.x 运行时会报错
    assert_eq!(skin[&region_name("frame_", 1)]["type"], "region");
}

#[test]
fn empty_animation_is_rejected() {
    let mut anim = two_frame_animation();
    anim.frames.clear();
    let cfg = ExportConfig {
        frame_count: 0,
        ..ExportConfig::default()
    };
    assert!(build_spine_json(&anim, &cfg).is_err());
}
