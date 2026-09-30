use spinevext_core::preprocess::{letterbox_transform, preprocess_letterbox};

#[test]
fn letterbox_keeps_aspect_ratio_and_pads_with_zeros() {
    // 4x2 的图放进 4x4：横向铺满，纵向居中补边
    let mut rgba = Vec::new();
    for _ in 0..2 {
        for x in 0..4u32 {
            rgba.extend_from_slice(&[(x * 60) as u8, 10, 20, 255]);
        }
    }

    let data = preprocess_letterbox(&rgba, 4, 2, 4, 4, false);
    let transform = letterbox_transform(4, 2, 4, 4);
    assert_eq!(data.len(), 4 * 4 * 3);
    assert!((transform.scale - 1.0).abs() < 1e-6);
    assert!((transform.offset_y - 1.0).abs() < 1e-6, "上下各补 1 行");

    // 第 0 行是补边，必须全 0
    for value in &data[0..12] {
        assert_eq!(*value, 0, "补边区域必须是黑边");
    }
    // 第 1 行第 0 个像素来自源图左上角
    let row1 = 4 * 3;
    assert_eq!(data[row1], 0);
    assert_eq!(data[row1 + 1], 10);
    assert_eq!(data[row1 + 2], 20);
    // 最后一行也是补边
    let last_row = 3 * 4 * 3;
    for value in &data[last_row..last_row + 12] {
        assert_eq!(*value, 0);
    }
}

#[test]
fn letterbox_flip_mirrors_horizontally() {
    let rgba: Vec<u8> = vec![0, 0, 0, 255, 255, 255, 255, 255];
    let normal = preprocess_letterbox(&rgba, 2, 1, 2, 1, false);
    let flipped = preprocess_letterbox(&rgba, 2, 1, 2, 1, true);
    assert_eq!(normal, vec![0, 0, 0, 255, 255, 255]);
    assert_eq!(flipped, vec![255, 255, 255, 0, 0, 0]);
}
