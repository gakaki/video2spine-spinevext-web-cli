//! 图集拼接、PNG 编码与打包。
//!
//! 全部使用纯 Rust 库（`png`、`zip`），不需要 libpng、ImageMagick 或 Node。

use std::fs::{create_dir_all, write};
use std::io::Write;
use std::path::Path;

use anyhow::{Context, Result};
use spinevext_core::atlas::{PackLayout, PackedRegion};

/// 把一帧按布局写进图集缓冲（最近邻缩放，够用且可预测）。
pub fn blit_region(
    atlas: &mut [u8],
    layout: &PackLayout,
    region: &PackedRegion,
    source: &[u8],
    source_width: u32,
    source_height: u32,
) {
    for row in 0..region.height {
        let source_y = (row * source_height / region.height.max(1)).min(source_height - 1);
        for column in 0..region.width {
            let source_x = (column * source_width / region.width.max(1)).min(source_width - 1);
            let from = ((source_y * source_width + source_x) * 4) as usize;
            let to = (((region.y + row) * layout.atlas_width + region.x + column) * 4) as usize;
            if from + 3 < source.len() && to + 3 < atlas.len() {
                atlas[to..to + 4].copy_from_slice(&source[from..from + 4]);
            }
        }
    }
}

/// RGBA8 → PNG 字节。
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    let mut buffer = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buffer, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().context("写 PNG 头失败")?;
        writer
            .write_image_data(rgba)
            .context("写 PNG 数据失败（缓冲长度应与宽高匹配）")?;
        writer.finish().context("收尾 PNG 失败")?;
    }
    Ok(buffer)
}

/// 落盘：散装三件套 + 一个 zip。
pub fn write_outputs(
    out_dir: &Path,
    name: &str,
    image_name: &str,
    json: &str,
    atlas_text: &str,
    png_bytes: &[u8],
) -> Result<()> {
    create_dir_all(out_dir).with_context(|| format!("创建输出目录 {} 失败", out_dir.display()))?;

    let json_path = out_dir.join(format!("{name}.json"));
    let atlas_path = out_dir.join(format!("{name}.atlas"));
    let png_path = out_dir.join(image_name);

    write(&json_path, json)?;
    write(&atlas_path, atlas_text)?;
    write(&png_path, png_bytes)?;

    let zip_path = out_dir.join(format!("{name}.zip"));
    let file = std::fs::File::create(&zip_path)
        .with_context(|| format!("创建 {} 失败", zip_path.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(format!("{name}.json"), options)?;
    zip.write_all(json.as_bytes())?;
    zip.start_file(format!("{name}.atlas"), options)?;
    zip.write_all(atlas_text.as_bytes())?;
    zip.start_file(image_name, options)?;
    zip.write_all(png_bytes)?;
    zip.finish().context("写完 zip 失败")?;

    Ok(())
}
