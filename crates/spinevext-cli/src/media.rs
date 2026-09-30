//! 取帧层：调用系统 ffmpeg / ffprobe。
//!
//! 视频解码不是 Rust 生态的强项（现成的库基本都在包 FFmpeg），
//! 所以这里用子进程把视频解成原始 RGBA 流，逐帧喂给推理。
//! 这也是整个 CLI 唯一的外部依赖。

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

/// 视频基本信息。
pub struct Probe {
    pub width: u32,
    pub height: u32,
    pub duration: f32,
}

/// 用 ffprobe 读取分辨率与时长。
pub fn probe(path: &Path) -> Result<Probe> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .context("调不出 ffprobe：请先安装 ffmpeg（macOS: brew install ffmpeg）")?;
    if !output.status.success() {
        bail!("ffprobe 解析失败，请确认输入是有效的视频文件");
    }

    let parsed: serde_json::Value =
        serde_json::from_slice(&output.stdout).context("ffprobe 输出不是合法 JSON")?;
    let stream = parsed["streams"]
        .as_array()
        .and_then(|streams| {
            streams
                .iter()
                .find(|stream| stream["codec_type"].as_str() == Some("video"))
        })
        .context("视频里没有图像流")?;

    let width = stream["width"].as_u64().context("读不到视频宽度")? as u32;
    let height = stream["height"].as_u64().context("读不到视频高度")? as u32;
    let duration = parsed["format"]["duration"]
        .as_str()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(0.0);

    Ok(Probe {
        width,
        height,
        duration,
    })
}

/// 按 `fps` 采样，把每一帧 RGBA 交给回调；返回总帧数。
///
/// 回调返回 `Err` 会立刻中断 ffmpeg 进程。
pub fn for_each_frame<F>(path: &Path, width: u32, height: u32, fps: f32, mut on_frame: F) -> Result<usize>
where
    F: FnMut(&[u8], usize) -> Result<()>,
{
    let mut child = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args([
            "-vf",
            &format!("fps={fps},scale={width}:{height}"),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .context("调不起 ffmpeg：请先安装 ffmpeg")?;

    let frame_bytes = (width * height * 4) as usize;
    let mut stdout = child.stdout.take().context("拿不到 ffmpeg 的输出管道")?;
    let mut buffer = vec![0u8; frame_bytes];
    let mut index = 0usize;
    let mut result: Result<()> = Ok(());

    loop {
        match read_exact_or_eof(&mut stdout, &mut buffer)? {
            false => break,
            true => {}
        }
        if let Err(error) = on_frame(&buffer, index) {
            result = Err(error);
            break;
        }
        index += 1;
    }

    // 主动收尾，避免回调报错时留下僵尸进程
    let _ = child.kill();
    let status = child.wait().context("等待 ffmpeg 退出失败")?;
    result?;
    if index == 0 && !status.success() {
        bail!("ffmpeg 没有输出任何帧（退出码 {:?}）", status.code());
    }
    Ok(index)
}

/// 读满一整帧返回 `true`，流结束返回 `false`。
fn read_exact_or_eof(reader: &mut impl Read, buffer: &mut [u8]) -> Result<bool> {
    let mut filled = 0usize;
    while filled < buffer.len() {
        let read = reader.read(&mut buffer[filled..])?;
        if read == 0 {
            return Ok(false);
        }
        filled += read;
    }
    Ok(true)
}
