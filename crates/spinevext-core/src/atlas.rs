//! 帧装箱与 Spine `.atlas` 文本生成。
//!
//! 对应原版 `CurrentBoneLayoutToTexture` / `CenterImagesInCanvas` 那部分逻辑：
//! 把 N 帧视频画面拼进一张大图，并生成 Spine 能识别的 atlas 描述文件。
//! 装箱算法用经典的天际线（shelf）策略——帧尺寸全部相同时它就是最优解，
//! 且实现足够简单可测。

use serde::{Deserialize, Serialize};

use crate::spine::region_name;

/// 一张图里某个 region 的位置。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackedRegion {
    pub name: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub index: u32,
}

/// 装箱结果。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackLayout {
    pub atlas_width: u32,
    pub atlas_height: u32,
    pub regions: Vec<PackedRegion>,
}

/// 装箱参数。
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PackConfig {
    /// 图集最大宽度，超过就换行。
    pub max_width: u32,
    /// region 之间的空隙，避免采样时的边缘渗色。
    pub padding: u32,
    /// 视频帧在图集里的缩放。
    pub scale: f32,
}

impl Default for PackConfig {
    fn default() -> Self {
        Self {
            max_width: 4096,
            padding: 2,
            scale: 1.0,
        }
    }
}

/// 把 `count` 张 `frame_w × frame_h` 的帧排进一张图集。
pub fn pack_frames(
    frame_w: u32,
    frame_h: u32,
    count: u32,
    cfg: &PackConfig,
) -> Result<PackLayout, String> {
    if count == 0 || frame_w == 0 || frame_h == 0 {
        return Err("帧尺寸或数量非法".to_string());
    }
    let scale = if cfg.scale > 0.0 { cfg.scale } else { 1.0 };
    let scaled_w = ((frame_w as f32 * scale).round() as u32).max(1);
    let scaled_h = ((frame_h as f32 * scale).round() as u32).max(1);
    let padding = cfg.padding;
    let max_width = cfg.max_width.max(scaled_w + padding);

    let per_row = ((max_width + padding) / (scaled_w + padding)).max(1);
    let rows = count.div_ceil(per_row);
    let atlas_width = (per_row * (scaled_w + padding) + padding).min(max_width);
    let atlas_height = rows * (scaled_h + padding) + padding;

    let regions = (0..count)
        .map(|index| {
            let column = index % per_row;
            let row = index / per_row;
            PackedRegion {
                name: region_name("frame_", index as usize),
                x: padding + column * (scaled_w + padding),
                y: padding + row * (scaled_h + padding),
                width: scaled_w,
                height: scaled_h,
                index,
            }
        })
        .collect();

    Ok(PackLayout {
        atlas_width,
        atlas_height,
        regions,
    })
}

/// 生成 Spine `.atlas` 文本。
pub fn build_atlas(
    layout: &PackLayout,
    image_name: &str,
    filter: &str,
    repeat: &str,
) -> String {
    let mut output = String::new();
    output.push_str(image_name);
    output.push('\n');
    output.push_str(&format!("size: {},{}\n", layout.atlas_width, layout.atlas_height));
    output.push_str("format: RGBA8888\n");
    output.push_str(&format!("filter: {filter}\n"));
    output.push_str(&format!("repeat: {repeat}\n"));
    for region in &layout.regions {
        output.push_str(&region.name);
        output.push('\n');
        output.push_str("  rotate: false\n");
        output.push_str(&format!("  xy: {}, {}\n", region.x, region.y));
        output.push_str(&format!("  size: {}, {}\n", region.width, region.height));
        output.push_str(&format!("  orig: {}, {}\n", region.width, region.height));
        output.push_str("  offset: 0, 0\n");
        output.push_str("  index: -1\n");
    }
    output
}
