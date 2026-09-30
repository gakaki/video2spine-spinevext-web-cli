use spinevext_core::preprocess::{preprocess, transform_for};
use spinevext_core::types::ImageTransform;

/// 原版资源里提取出来的归一化参数。
const MEAN: [f32; 3] = [0.482941176, 0.454509803, 0.404156862];

#[test]
fn solid_color_is_normalized_into_nchw() {
    // 2x2 纯红图
    let rgba: Vec<u8> = std::iter::repeat([255u8, 0, 0, 255])
        .take(4)
        .flatten()
        .collect();

    let out = preprocess(&rgba, 2, 2, 2, 2, &MEAN, 255.0, false);

    assert_eq!(out.len(), 3 * 2 * 2, "输出必须是 [1,3,H,W] 的 NCHW 张量");
    let plane = 4;
    for value in &out[0..plane] {
        assert!(
            (value - (1.0 - MEAN[0])).abs() < 1e-5,
            "红通道应等于 255/255 - mean[0]，实际 {value}"
        );
    }
    for value in &out[plane..plane * 2] {
        assert!((value + MEAN[1]).abs() < 1e-5, "绿通道应等于 0/255 - mean[1]");
    }
    for value in &out[plane * 2..plane * 3] {
        assert!((value + MEAN[2]).abs() < 1e-5, "蓝通道应等于 0/255 - mean[2]");
    }
}

#[test]
fn cover_transform_crops_the_long_side() {
    // 4x2 的横图贴到 2x2 的方形输入：应该只保留中间两列
    let transform = transform_for(4, 2, 2, 2);
    assert!((transform.scale - 1.0).abs() < 1e-6, "缩放系数应为 1");
    assert!(
        (transform.offset_x - (-1.0)).abs() < 1e-6,
        "左边应被裁掉一列，offset_x 应为 -1，实际 {}",
        transform.offset_x
    );
    assert!(transform.offset_y.abs() < 1e-6, "纵向没有多余部分");

    // 造一张按列渐变的图：R 通道 = 列号 * 60
    let mut rgba = Vec::new();
    for y in 0..2u32 {
        for x in 0..4u32 {
            rgba.extend_from_slice(&[(x * 60) as u8, 0, 0, 255]);
            let _ = y;
        }
    }
    let out = preprocess(&rgba, 4, 2, 2, 2, &[0.0, 0.0, 0.0], 255.0, false);
    // 目标像素中心映射到源图的连续坐标 x=1.5 与 x=2.5，
    // 即源图第 1 列（值 60）与第 2 列（值 120）——正是被保留下来的中间两列。
    assert!((out[0] - 60.0 / 255.0).abs() < 0.01, "第一个像素应来自源图第 1 列");
    assert!((out[1] - 120.0 / 255.0).abs() < 0.01, "第二个像素应来自源图第 2 列");
}

#[test]
fn empty_input_does_not_panic() {
    let out = preprocess(&[], 0, 0, 4, 4, &MEAN, 255.0, false);
    assert_eq!(out.len(), 3 * 4 * 4);
    assert!(out.iter().all(|value| value.is_finite()));
    assert_eq!(ImageTransform::default().scale, 1.0);
}

#[test]
fn flip_x_mirrors_the_source_image() {
    // 2x1 图：左像素 R=0，右像素 R=255
    let rgba: Vec<u8> = vec![0, 0, 0, 255, 255, 0, 0, 255];
    let normal = preprocess(&rgba, 2, 1, 2, 1, &[0.0, 0.0, 0.0], 255.0, false);
    let flipped = preprocess(&rgba, 2, 1, 2, 1, &[0.0, 0.0, 0.0], 255.0, true);

    assert!((normal[0] - 0.0).abs() < 1e-4);
    assert!((normal[1] - 1.0).abs() < 1e-4);
    assert!((flipped[0] - 1.0).abs() < 1e-4, "镜像后第一个像素应来自原图右侧");
    assert!((flipped[1] - 0.0).abs() < 1e-4);
}
