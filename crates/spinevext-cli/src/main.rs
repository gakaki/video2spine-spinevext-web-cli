//! SpineVExt 纯 Rust CLI。
//!
//! 与浏览器版、Node 版共用同一个 `spinevext-core` 算法内核，区别只在两端：
//! * 取帧：调用系统 `ffmpeg`（视频解码不是 Rust 生态的强项，用子进程最稳）
//! * 推理：`tract-onnx` 纯 Rust 执行 ONNX，不需要 ONNX Runtime 或 Node
//!
//! 于是整条链路只需要 rustc + ffmpeg 两个依赖：
//!
//! ```text
//! ffmpeg 取帧 → tract-onnx 推理 → spinevext-core 解码/骨骼/动画 → PNG + Atlas + JSON → zip
//! ```
//!
//! 用法：
//! ```bash
//! cargo run -p spinevext-cli --release -- input.mp4 --out ./out
//! ```

mod bundle;
mod media;
mod onnx;
mod onnx_trim;

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use spinevext_core::animate::{build_animation, AnimConfig};
use spinevext_core::atlas::{build_atlas, pack_frames, PackConfig};
use spinevext_core::rig::{poses_to_bones, RigConfig};
use spinevext_core::smooth::smooth_poses;
use spinevext_core::spine::{build_spine_json, ExportConfig};
use spinevext_core::types::{Pose2D, SmoothConfig, KEYPOINT_NAMES};

/// 视频 → Spine 骨骼动画。
#[derive(Parser, Debug)]
#[command(
    name = "spinevext",
    version,
    about = "把人物视频转成 Spine 骨骼动画工程（纯 Rust 实现）",
    long_about = None
)]
struct Args {
    /// 输入视频（需要系统安装 ffmpeg / ffprobe）。
    input: PathBuf,

    /// 输出目录。
    #[arg(short, long, default_value = "out")]
    out: PathBuf,

    /// 工程名（默认取输入文件名）。
    #[arg(long)]
    name: Option<String>,

    /// 采样帧率。
    #[arg(long, default_value_t = 15.0)]
    fps: f32,

    /// 取帧宽度上限。
    #[arg(long, default_value_t = 960)]
    max_width: u32,

    /// ONNX 姿态模型路径。
    #[arg(long, default_value = "public/models/movenet-singlepose-lightning.onnx")]
    model: PathBuf,

    /// 置信度阈值。
    #[arg(long, default_value_t = 0.3)]
    confidence: f32,

    /// 平滑窗口帧数（1 = 关闭）。
    #[arg(long, default_value_t = 5)]
    smooth: u32,

    /// 判定一帧可用的最少高置信度关节点数量。
    #[arg(long, default_value_t = 6)]
    min_keypoints: u32,

    /// 图集最大宽度。
    #[arg(long, default_value_t = 4096)]
    atlas_width: u32,

    /// 图集缩放。
    #[arg(long, default_value_t = 1.0)]
    image_scale: f32,

    /// 只做推理并把统计打到 stdout，不写文件。
    #[arg(long)]
    dry_run: bool,

    /// 强制打开 tract 的完整图优化（算子融合，推理明显更快）。
    #[arg(long)]
    optimize: bool,

    /// 强制关闭图优化。默认策略：剪过图的 MoveNet 开优化（实测快 5 倍且省内存），
    /// 其它模型不开——tract 的优化器在带数据相关后处理的图上会吃掉几十 GB 内存。
    #[arg(long, conflicts_with = "optimize")]
    no_optimize: bool,

    /// 把剪掉后处理尾巴的模型写到这个路径，便于用别的工具核对。
    #[arg(long)]
    dump_trimmed: Option<PathBuf>,
}

fn main() -> Result<()> {
    // 需要时用 RUST_LOG=tract_core=debug 打开 tract 内部日志
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    let args = Args::parse();
    run(args)
}

fn run(args: Args) -> Result<()> {
    let probe = media::probe(&args.input)?;
    let width = probe.width.min(args.max_width).max(2);
    let height = ((probe.height as f32 * width as f32 / probe.width as f32) / 2.0).round() as u32 * 2;
    let height = height.max(2);
    let estimated = (probe.duration * args.fps).max(1.0) as usize;

    println!(
        "输入 {}：{}×{}，{:.2}s\n取帧 {}×{} @ {}fps，预计 {} 帧",
        args.input.display(),
        probe.width,
        probe.height,
        probe.duration,
        width,
        height,
        args.fps,
        estimated
    );

    // 三态：显式 --optimize / --no-optimize，否则按"是否剪过图"自动决定
    let optimize = if args.no_optimize {
        Some(false)
    } else if args.optimize {
        Some(true)
    } else {
        None
    };
    let mut model = onnx::PoseOnnx::load(&args.model, optimize, args.dump_trimmed.as_deref())?;
    println!(
        "模型 {}：{}×{}（{}）",
        model.kind_label(),
        model.input_width,
        model.input_height,
        model.input_dtype_label()
    );

    let name = args.name.clone().unwrap_or_else(|| {
        args.input
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| "spinevext".to_string())
    });

    let mut poses: Vec<Vec<Pose2D>> = Vec::new();
    let started = std::time::Instant::now();

    media::for_each_frame(&args.input, width, height, args.fps, |rgba, index| {
        let pose = model
            .detect(rgba, width, height, args.confidence, 1)
            .with_context(|| format!("第 {index} 帧推理失败"))?;
        poses.push(vec![pose]);
        if index > 0 && index % 25 == 0 {
            print!("\r  已处理 {index} 帧");
            use std::io::Write;
            let _ = std::io::stdout().flush();
        }
        Ok(())
    })?;

    println!();
    if poses.is_empty() {
        anyhow::bail!("没有取到任何帧，请检查输入视频与 ffmpeg 安装");
    }
    println!(
        "推理完成：{} 帧，用时 {:.1}s",
        poses.len(),
        started.elapsed().as_secs_f32()
    );

    let smoothed = smooth_poses(
        &poses,
        &SmoothConfig {
            buffer_size: args.smooth,
            confidence_threshold: args.confidence,
        },
    );
    let rig_config = RigConfig {
        min_confident_keypoints: args.min_keypoints,
        confidence_threshold: args.confidence.min(0.25),
    };
    let bones = poses_to_bones(&smoothed, &rig_config, height as f32);
    let animation = build_animation(
        &bones,
        &smoothed,
        &AnimConfig {
            fps: args.fps,
            base_frame: -1,
            propagate: true,
        },
        &rig_config,
        height as f32,
    );

    let layout = pack_frames(
        width,
        height,
        animation.frames.len() as u32,
        &PackConfig {
            max_width: args.atlas_width,
            padding: 2,
            scale: args.image_scale,
        },
    )
    .map_err(anyhow::Error::msg)?;
    println!(
        "图集：{}×{}，{} 个 region",
        layout.atlas_width,
        layout.atlas_height,
        layout.regions.len()
    );

    // 再取一遍帧，把画面按布局铺进图集缓冲
    let mut atlas = vec![0u8; (layout.atlas_width * layout.atlas_height * 4) as usize];
    let mut placed = 0usize;
    media::for_each_frame(&args.input, width, height, args.fps, |rgba, index| {
        if let Some(region) = layout.regions.iter().find(|region| region.index as usize == index) {
            bundle::blit_region(&mut atlas, &layout, region, rgba, width, height);
            placed += 1;
        }
        Ok(())
    })?;
    println!("图集已铺满 {placed} 帧");

    let export_config = ExportConfig {
        name: name.clone(),
        animation_name: "video".to_string(),
        frame_width: width as f32,
        frame_height: height as f32,
        frame_count: animation.frames.len() as u32,
        fps: args.fps,
        region_prefix: "frame_".to_string(),
        image_name: format!("{name}.png"),
        image_scale: args.image_scale,
    };
    let json = build_spine_json(&animation, &export_config).map_err(anyhow::Error::msg)?;
    let atlas_text = build_atlas(&layout, &export_config.image_name, "Linear,Linear", "none");
    let png_bytes = bundle::encode_png(layout.atlas_width, layout.atlas_height, &atlas)?;

    if args.dry_run {
        println!(
            "dry-run：有效骨骼帧 {}/{}，基准帧 #{}，json {} 字节，png {} 字节",
            animation.validity.iter().filter(|valid| **valid).count(),
            animation.frames.len(),
            animation.base_frame,
            json.len(),
            png_bytes.len()
        );
        return Ok(());
    }

    bundle::write_outputs(
        &args.out,
        &name,
        &export_config.image_name,
        &json,
        &atlas_text,
        &png_bytes,
    )?;

    println!(
        "\n导出完成：{}\n  {name}.json  Spine 4.3 骨架 + 动画\n  {name}.atlas 图集描述\n  {}  {}×{}\n  {name}.zip   三件套打包\n  有效骨骼帧 {}/{}，基准帧 #{}",
        args.out.join(format!("{name}.zip")).display(),
        export_config.image_name,
        layout.atlas_width,
        layout.atlas_height,
        animation.validity.iter().filter(|valid| **valid).count(),
        animation.frames.len(),
        animation.base_frame
    );
    println!("关键点顺序：{}", KEYPOINT_NAMES.join(", "));
    Ok(())
}
