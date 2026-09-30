//! 图像预处理：RGBA 源图 → 归一化后的 NCHW `f32` 张量。
//!
//! 对应原版的 `DeepLearningImageProcessor` + `NormalizeImage` 计算着色器：
//! 先等比缩放并居中裁剪到模型输入尺寸，再按 `pixel/scale - mean[c]` 归一化，
//! 最后从 HWC 排布转成模型需要的 NCHW 排布。

use crate::types::ImageTransform;

/// 采样一个源像素（双线性插值），越界坐标按最近边界处理。
fn sample_bilinear(rgba: &[u8], src_w: u32, src_h: u32, x: f32, y: f32, channel: usize) -> f32 {
    let x = x.clamp(0.0, (src_w as f32 - 1.0).max(0.0));
    let y = y.clamp(0.0, (src_h as f32 - 1.0).max(0.0));
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(src_w.saturating_sub(1));
    let y1 = (y0 + 1).min(src_h.saturating_sub(1));
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;

    let at = |px: u32, py: u32| -> f32 {
        let idx = ((py * src_w + px) * 4) as usize + channel;
        rgba.get(idx).copied().unwrap_or(0) as f32
    };

    let top = at(x0, y0) * (1.0 - fx) + at(x1, y0) * fx;
    let bottom = at(x0, y1) * (1.0 - fx) + at(x1, y1) * fx;
    top * (1.0 - fy) + bottom * fy
}

/// 把 RGBA 图预处理成 `[1, 3, dst_h, dst_w]` 的 NCHW 张量。
///
/// * `mean` —— 三个通道的均值，原版为 `[0.482941176, 0.454509803, 0.404156862]`
/// * `scale` —— 像素缩放系数，原版为 `255.0`
/// * `flip_x` —— 水平镜像（摄像头自拍视角）。镜像必须发生在**取帧/预处理阶段**，
///   否则解码出来的关节点和画面会左右错位。
pub fn preprocess(
    rgba: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    mean: &[f32],
    scale: f32,
    flip_x: bool,
) -> Vec<f32> {
    let plane = (dst_w * dst_h) as usize;
    let mut out = vec![0.0f32; plane * 3];
    if src_w == 0 || src_h == 0 || dst_w == 0 || dst_h == 0 {
        return out;
    }

    let transform = ImageTransform::cover(src_w, src_h, dst_w, dst_h);
    let scale = if scale == 0.0 { 1.0 } else { scale };
    let default_mean = [0.0f32, 0.0, 0.0];
    let mean = if mean.len() >= 3 { mean } else { &default_mean };

    for dy in 0..dst_h {
        for dx in 0..dst_w {
            // 目标像素中心 → 源图连续坐标
            let (mut sx, sy) = transform.to_source(dx as f32 + 0.5, dy as f32 + 0.5);
            if flip_x {
                sx = src_w as f32 - sx;
            }
            let offset = (dy * dst_w + dx) as usize;
            for (channel, channel_mean) in mean.iter().enumerate().take(3) {
                let value = sample_bilinear(rgba, src_w, src_h, sx - 0.5, sy - 0.5, channel);
                out[channel * plane + offset] = value / scale - channel_mean;
            }
        }
    }

    out
}

/// 计算预处理使用的变换参数，供解码阶段把坐标映射回源图。
pub fn transform_for(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> ImageTransform {
    ImageTransform::cover(src_w, src_h, dst_w, dst_h)
}

/// letterbox 的坐标变换：等比缩小并居中补边。
///
/// 与 [`ImageTransform::cover`] 的区别是取 `min` 而不是 `max`，
/// 因此整张源图都会留在画面里，多出来的部分用黑边填充。
pub fn letterbox_transform(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> ImageTransform {
    let sw = src_w.max(1) as f32;
    let sh = src_h.max(1) as f32;
    let scale = (dst_w as f32 / sw).min(dst_h as f32 / sh);
    ImageTransform {
        scale,
        offset_x: (dst_w as f32 - sw * scale) * 0.5,
        offset_y: (dst_h as f32 - sh * scale) * 0.5,
    }
}

/// 「保比例 + 补边」的预处理数据，用于 MoveNet 这类输入必须是
/// `[1, H, W, 3]` 整型 RGB 的模型。
///
/// 与 [`preprocess`] 的 cover 裁剪不同，letterbox 会把整张源图缩放到能放进
/// 目标尺寸的最大比例，空出来的边填 0，因此不会裁掉画面两侧的手臂。
///
/// 返回展平后的 `[1, dst_h, dst_w, 3]` RGB 整型数据；坐标变换见
/// [`letterbox_transform`]。
pub fn preprocess_letterbox(
    rgba: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    flip_x: bool,
) -> Vec<i32> {
    let mut data = vec![0i32; (dst_w * dst_h * 3) as usize];
    if src_w == 0 || src_h == 0 || dst_w == 0 || dst_h == 0 {
        return data;
    }

    let sw = src_w as f32;
    let sh = src_h as f32;
    let transform = letterbox_transform(src_w, src_h, dst_w, dst_h);

    for dy in 0..dst_h {
        for dx in 0..dst_w {
            let (mut sx, sy) = transform.to_source(dx as f32 + 0.5, dy as f32 + 0.5);
            if flip_x {
                sx = sw - sx;
            }
            let offset = ((dy * dst_w + dx) * 3) as usize;
            // 落在源图之外的部分保持 0，这就是 letterbox 的黑边
            let inside = sx >= 0.0 && sy >= 0.0 && sx <= sw && sy <= sh;
            if inside {
                for channel in 0..3 {
                    let value = sample_bilinear(rgba, src_w, src_h, sx - 0.5, sy - 0.5, channel);
                    data[offset + channel] = value.round().clamp(0.0, 255.0) as i32;
                }
            }
        }
    }

    data
}
