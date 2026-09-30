use spinevext_core::decode::decode_regression;
use spinevext_core::types::ImageTransform;

#[test]
fn normalized_coordinates_map_to_source_pixels() {
    let mut values = vec![0.0f32; 17 * 3];
    // 鼻子：中心偏上
    values[0] = 0.25; // y
    values[1] = 0.50; // x
    values[2] = 0.9; // score
    // 左肩
    values[5 * 3] = 0.4;
    values[5 * 3 + 1] = 0.4;
    values[5 * 3 + 2] = 0.8;

    // 源图 1920x1080 letterbox 到 192x192：scale = 0.1，纵向补边 69
    let transform = ImageTransform {
        scale: 0.1,
        offset_x: 0.0,
        offset_y: 69.0,
    };
    let pose = decode_regression(&values, 17, 192, 192, &transform);
    assert_eq!(pose.keypoints.len(), 17);
    let nose = pose.keypoints[0];
    // y: (0.25 * 192 - 69) / 0.1 = -210；x: 0.5 * 192 / 0.1 = 960
    assert!((nose.x - 960.0).abs() < 1e-2, "x = 0.5 * 192 / 0.1");
    assert!((nose.y - (-210.0)).abs() < 1e-2, "y = (0.25 * 192 - 69) / 0.1");
    assert!((nose.score - 0.9).abs() < 1e-6);

    let shoulder = pose.keypoints[5];
    assert!((shoulder.x - 768.0).abs() < 1e-3);
    // y: (0.4 * 192 - 69) / 0.1 = 78
    assert!((shoulder.y - 78.0).abs() < 1e-2);
}

#[test]
fn short_input_does_not_panic_and_keeps_frame_shape() {
    let values = vec![0.5f32; 2 * 3];
    let pose = decode_regression(&values, 17, 192, 192, &ImageTransform::default());
    assert_eq!(pose.keypoints.len(), 17);
    assert!(pose.keypoints.iter().all(|k| k.x.is_finite() && k.y.is_finite()));
    assert!(pose.score.is_finite());
}
