use std::collections::HashSet;

use spinevext_core::atlas::{build_atlas, pack_frames, PackConfig};

#[test]
fn packed_regions_stay_inside_and_do_not_overlap() {
    let cfg = PackConfig {
        max_width: 1024,
        padding: 2,
        scale: 1.0,
    };
    let layout = pack_frames(320, 180, 100, &cfg).expect("装箱应成功");

    assert_eq!(layout.regions.len(), 100);
    for region in &layout.regions {
        assert!(region.x + region.width <= layout.atlas_width);
        assert!(region.y + region.height <= layout.atlas_height);
    }

    let mut seen: HashSet<(u32, u32, u32, u32)> = HashSet::new();
    for (index, region) in layout.regions.iter().enumerate() {
        assert!(seen.insert((region.x, region.y, region.width, region.height)));
        assert_eq!(region.index, index as u32);
    }

    // 除了最后一行，同一行的 region 应逐个排开
    let first_row_count = layout
        .regions
        .iter()
        .take_while(|region| region.y == layout.regions[0].y)
        .count();
    assert!(first_row_count >= 2, "1024 宽应该能放下至少两帧");

    let used: f64 = layout
        .regions
        .iter()
        .map(|r| (r.width * r.height) as f64)
        .sum();
    let total = (layout.atlas_width * layout.atlas_height) as f64;
    assert!(used / total > 0.5, "面积利用率应大于 50%，实际 {}", used / total);
}

#[test]
fn atlas_text_has_required_fields() {
    let cfg = PackConfig::default();
    let layout = pack_frames(160, 90, 3, &cfg).expect("装箱应成功");
    let text = build_atlas(&layout, "spinevext.png", "Linear,Linear", "none");

    assert!(text.starts_with("spinevext.png\n"), "首行必须是图片名");
    assert!(text.contains(&format!("size: {},{}", layout.atlas_width, layout.atlas_height)));
    assert!(text.contains("format: RGBA8888"));
    assert!(text.contains("filter: Linear,Linear"));
    assert!(text.contains("repeat: none"));
    assert!(text.contains("frame_0000"));
    assert!(text.contains(&format!("  xy: {}, {}", layout.regions[0].x, layout.regions[0].y)));
    assert!(text.contains("  index: -1"));
}

#[test]
fn scale_shrinks_regions() {
    let cfg = PackConfig {
        max_width: 4096,
        padding: 0,
        scale: 0.5,
    };
    let layout = pack_frames(320, 180, 4, &cfg).expect("装箱应成功");
    assert_eq!(layout.regions[0].width, 160);
    assert_eq!(layout.regions[0].height, 90);
}
