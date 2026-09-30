//! 纯 Rust 的 ONNX 推理层（tract-onnx）。
//!
//! 与浏览器版 `src/core/inference.ts` 一一对应：同样自动识别模型家族，
//! 只是把 onnxruntime 换成了 tract。识别与解码规则和 Rust 内核保持一致，
//! 区别只在于这里直接给出 `Pose2D`。

use std::path::Path;

use anyhow::{bail, Context, Result};
use tract_onnx::prelude::*;
// `concretize` 来自 Factoid trait，prelude 的 glob 没有把它带进来
use tract_onnx::tract_hir::infer::Factoid;
// `to_usize` 来自 DimLike（它只在 internal 里导出，不在 prelude）
use tract_onnx::tract_hir::tract_core::internal::DimLike;

use spinevext_core::decode::{decode, decode_regression};
use spinevext_core::preprocess;
use spinevext_core::types::{
    DecodeConfig, ImageTransform, Pose2D, TensorLayout, KEYPOINT_NAMES,
};

use crate::onnx_trim;

/// PoseNet 家族的归一化参数（来自原版 Unity 资源）。
const POSE_NET_MEAN: [f32; 3] = [0.482941176, 0.454509803, 0.404156862];
const POSE_NET_SCALE: f32 = 255.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelKind {
    /// heatmap + offset 输出（原版用的 ResNet50 PoseNet 家族）。
    PoseNet,
    /// 直接回归 `[1,1,17,3]`（MoveNet 家族）。
    MoveNet,
    /// 剪掉后处理尾巴的 MoveNet：输出 heatmap + offset，offsets 以「格」为单位。
    MoveNetHeads,
}

struct HeadSpec {
    heatmap_index: usize,
    offset_index: usize,
    heatmap_nchw: bool,
    stride: u32,
}

/// 已加载并优化过的模型。
pub struct PoseOnnx {
    plan: SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>,
    pub kind: ModelKind,
    pub input_width: u32,
    pub input_height: u32,
    pub input_is_int: bool,
    /// 剪掉归一化前缀后，归一化改由 Rust 侧完成。
    normalize_in_rust: bool,
    regression_index: usize,
    head: Option<HeadSpec>,
}

impl PoseOnnx {
    /// 加载 ONNX 模型。
    ///
    /// `optimize` 三态：
    /// * `Some(true)` —— 走 tract 的完整优化（常量折叠 / 算子融合），推理最快；
    /// * `Some(false)` —— 只做类型推导，不做任何图变换；
    /// * `None` —— 自动：剪过图（只剩卷积主干）就开优化，否则不开。
    ///
    /// 自动策略的原因：tract 的优化器在**带数据相关后处理的图**上会爆炸
    /// （实测原始 MoveNet 顶到 24GB 并触发系统交换）；剪掉尾巴之后同一个
    /// 优化器只要 0.06s，而且推理快 5 倍、内存还更低。
    pub fn load(path: &Path, optimize: Option<bool>, dump_trimmed: Option<&Path>) -> Result<Self> {
        if !path.exists() {
            bail!(
                "找不到模型文件 {}。先执行 `vp run model`，或用 --model 指定路径",
                path.display()
            );
        }

        let started = std::time::Instant::now();
        let bytes = std::fs::read(path).with_context(|| format!("读取 {} 失败", path.display()))?;
        // MoveNet 导出的图尾部带着数据相关的后处理，tract 的类型推导会在那里
        // 无限膨胀。先剪掉尾巴，只留 heatmap / offset 两个卷积输出。
        let trimmed_heads = onnx_trim::needs_trim(&bytes)?;
        let bytes = if trimmed_heads {
            let trimmed = onnx_trim::trim(&bytes).context("剪掉 MoveNet 后处理尾部失败")?;
            progress(&started, "剪掉后处理尾部");
            if let Some(target) = dump_trimmed {
                std::fs::write(target, &trimmed)
                    .with_context(|| format!("写出剪尾模型 {} 失败", target.display()))?;
                eprintln!("  · 剪尾模型已写到 {}", target.display());
            }
            trimmed
        } else {
            bytes
        };

        let mut model = tract_onnx::onnx()
            .model_for_read(&mut bytes.as_slice())
            .with_context(|| format!("tract 无法解析 {}", path.display()))?;
        progress(&started, "解析 ONNX");

        // 输入 fact 去掉具体值，避免 tract 在 run 时做多余的符号求解。
        let input_fact = model.input_fact(0).ok().cloned();
        if let Some(fact) = input_fact {
            model = model
                .with_input_fact(0, fact.without_value())
                .context("归一化输入 fact 失败")?;
        }

        let typed = model.into_typed().context("类型推导失败")?;
        progress(&started, "类型推导");

        let optimize = optimize.unwrap_or(trimmed_heads);
        let typed = if optimize {
            typed
                .into_optimized()
                .context("模型优化失败（可先不加 --optimize 试试）")?
        } else {
            typed
        };
        progress(&started, if optimize { "图优化" } else { "跳过图优化" });

        let runnable = typed.into_runnable().context("模型编译失败")?;
        progress(&started, "编译执行计划");

        println!(
            "加载模型 {}（图优化：{}）",
            path.display(),
            if optimize { "开" } else { "关" }
        );

        // 诊断信息：模型有几个输入、各是什么形状
        for index in 0..runnable.model().inputs.len() {
            if let Ok(fact) = runnable.model().input_fact(index) {
                eprintln!("  · 输入 #{index}: {}", fact.format_dt_shape());
            }
        }
        for index in 0..runnable.model().outputs.len() {
            if let Ok(fact) = runnable.model().output_fact(index) {
                eprintln!("  · 输出 #{index}: {}", fact.format_dt_shape());
            }
        }
        // SPINEVEXT_DUMP_FACTS=1 时把每个节点的形状事实打出来，便于定位
        // "Clashing resolution" 这类符号冲突来自哪个节点。
        if std::env::var("SPINEVEXT_DUMP_FACTS").is_ok() {
            for node in runnable.model().nodes.iter() {
                let facts: Vec<String> = node
                    .outputs
                    .iter()
                    .enumerate()
                    .map(|(index, _)| {
                        node.outputs[index]
                            .fact
                            .to_typed_fact()
                            .map(|fact| fact.format_dt_shape().to_string())
                            .unwrap_or_else(|_| "?".to_string())
                    })
                    .collect();
                eprintln!("  · 节点 {} [{}] -> {}", node.name, node.op().name(), facts.join(" | "));
            }
        }

        let input_fact = runnable.model().input_fact(0)?;
        let shape = fact_dims(input_fact)?;
        if shape.len() != 4 {
            bail!("只支持 4 维输入，实际得到 {shape:?}");
        }

        // 靠 RGB 三通道判断排布：NCHW 的 axis1 是 3，NHWC 的 axis3 是 3
        let input_nchw = shape[1] == 3;
        let (input_height, input_width) = if input_nchw {
            (shape[2] as u32, shape[3] as u32)
        } else {
            (shape[1] as u32, shape[2] as u32)
        };
        let input_is_int = matches!(
            input_fact.datum_type,
            DatumType::I32 | DatumType::U8 | DatumType::I64
        );

        let output_facts: Vec<Vec<usize>> = (0..runnable.model().outputs.len())
            .filter_map(|index| runnable.model().output_fact(index).ok())
            .filter_map(|fact| fact_dims(fact).ok())
            .collect();

        // PoseNet：找通道数 17 的 heatmap 与通道数 34 的 offsets（按输入排布优先）
        let preferred = if input_nchw { 1 } else { 3 };
        let other = if preferred == 1 { 3 } else { 1 };
        let feature_axis = |dims: &Vec<usize>, want: usize| -> Option<usize> {
            if dims.get(preferred) == Some(&want) {
                Some(preferred)
            } else if dims.get(other) == Some(&want) {
                Some(other)
            } else {
                None
            }
        };

        let heatmap = output_facts
            .iter()
            .enumerate()
            .find(|(_, dims)| dims.len() == 4 && feature_axis(dims, 17).is_some());
        let offset = output_facts
            .iter()
            .enumerate()
            .find(|(_, dims)| dims.len() == 4 && feature_axis(dims, 34).is_some());

        if let (Some((heatmap_index, heatmap_dims)), Some((offset_index, _))) = (heatmap, offset) {
            let axis = feature_axis(heatmap_dims, 17).context("定位 heatmap 通道轴失败")?;
            let heatmap_nchw = axis == 1;
            let heatmap_height = if heatmap_nchw {
                heatmap_dims[2]
            } else {
                heatmap_dims[1]
            };
            return Ok(Self {
                plan: runnable,
                kind: if trimmed_heads {
                    ModelKind::MoveNetHeads
                } else {
                    ModelKind::PoseNet
                },
                input_width,
                input_height,
                input_is_int,
                normalize_in_rust: trimmed_heads,
                regression_index: 0,
                head: Some(HeadSpec {
                    heatmap_index,
                    offset_index,
                    heatmap_nchw,
                    stride: (input_height as f32 / heatmap_height.max(1) as f32).round().max(1.0)
                        as u32,
                }),
            });
        }

        // MoveNet：`[1,1,17,3]`
        let regression = output_facts
            .iter()
            .position(|dims| dims.len() == 4 && dims[3] == 3 && dims[2] == 17)
            .context("无法识别的姿态模型输出，请换用 MoveNet 或 PoseNet 家族的 ONNX")?;

        Ok(Self {
            plan: runnable,
            kind: ModelKind::MoveNet,
            input_width,
            input_height,
            input_is_int,
            normalize_in_rust: trimmed_heads,
            regression_index: regression,
            head: None,
        })
    }

    pub fn kind_label(&self) -> &'static str {
        match self.kind {
            ModelKind::PoseNet => "PoseNet",
            ModelKind::MoveNet => "MoveNet",
            ModelKind::MoveNetHeads => "MoveNet（剪图）",
        }
    }

    pub fn input_dtype_label(&self) -> &'static str {
        if self.input_is_int {
            "int32"
        } else {
            "float32"
        }
    }

    /// 一帧 RGBA → 一个人形姿态。返回分数最高的人。
    pub fn detect(
        &mut self,
        rgba: &[u8],
        width: u32,
        height: u32,
        confidence: f32,
        max_poses: u32,
    ) -> Result<Pose2D> {
        let poses = match self.kind {
            // 完整 MoveNet：图内自带 argmax 尾巴，直接出 [1,1,17,3]
            ModelKind::MoveNet => {
                let (input, transform) = self.prepare_movenet_input(rgba, width, height)?;
                let outputs = self.plan.run(tvec!(input.into()))?;
                let values = to_f32(&outputs[self.regression_index])?.0;
                vec![decode_regression(
                    &values,
                    KEYPOINT_NAMES.len(),
                    self.input_width,
                    self.input_height,
                    &transform,
                )]
            }
            // 剪尾后的 MoveNet 与 PoseNet 都是 heatmap + offset，但输入方式不同：
            // MoveNet 用 NHWC + letterbox，PoseNet 用 NCHW + cover 裁剪。
            ModelKind::MoveNetHeads => {
                let (input, transform) = self.prepare_movenet_input(rgba, width, height)?;
                let outputs = self.plan.run(tvec!(input.into()))?;
                self.decode_heads(&outputs, &transform, confidence, max_poses)?
            }
            ModelKind::PoseNet => {
                let (input, transform) = self.prepare_posenet_input(rgba, width, height)?;
                let outputs = self.plan.run(tvec!(input.into()))?;
                self.decode_heads(&outputs, &transform, confidence, max_poses)?
            }
        };
        poses
            .into_iter()
            .max_by(|a, b| a.score.total_cmp(&b.score))
            .context("这一帧没有检测到可用的姿态")
    }

    /// MoveNet 输入：letterbox 成 NHWC。
    ///
    /// 剪掉归一化前缀后，模型要的是已归一化的 f32，这里按 MoveNet 的标准
    /// `(x - 127.5) / 127.5` 在 Rust 侧完成。
    fn prepare_movenet_input(
        &self,
        rgba: &[u8],
        width: u32,
        height: u32,
    ) -> Result<(Tensor, ImageTransform)> {
        let transform =
            preprocess::letterbox_transform(width, height, self.input_width, self.input_height);
        let data = preprocess::preprocess_letterbox(
            rgba,
            width,
            height,
            self.input_width,
            self.input_height,
            false,
        );

        let shape = (
            1,
            self.input_height as usize,
            self.input_width as usize,
            3,
        );
        let input: Tensor = if self.normalize_in_rust {
            let floats: Vec<f32> = data
                .iter()
                .map(|value| (*value as f32 - 127.5) / 127.5)
                .collect();
            tract_ndarray::Array4::from_shape_vec(shape, floats)
                .context("构造输入张量失败")?
                .into_tensor()
        } else if self.input_is_int {
            tract_ndarray::Array4::from_shape_vec(shape, data)
                .context("构造输入张量失败")?
                .into_tensor()
        } else {
            let floats: Vec<f32> = data.iter().map(|value| *value as f32).collect();
            tract_ndarray::Array4::from_shape_vec(shape, floats)
                .context("构造输入张量失败")?
                .into_tensor()
        };

        Ok((input, transform))
    }

    /// PoseNet 输入：cover 裁剪 + 归一化 NCHW。
    fn prepare_posenet_input(
        &self,
        rgba: &[u8],
        width: u32,
        height: u32,
    ) -> Result<(Tensor, ImageTransform)> {
        let transform = preprocess::transform_for(width, height, self.input_width, self.input_height);
        let data = preprocess::preprocess(
            rgba,
            width,
            height,
            self.input_width,
            self.input_height,
            &POSE_NET_MEAN,
            POSE_NET_SCALE,
            false,
        );
        let input = tract_ndarray::Array4::from_shape_vec(
            (1, 3, self.input_height as usize, self.input_width as usize),
            data,
        )
        .context("构造输入张量失败")?
        .into_tensor();
        Ok((input, transform))
    }

    /// heatmap + offset 解码：交给内核，与原版 PoseNet 用的是同一份实现。
    fn decode_heads(
        &self,
        outputs: &TVec<TValue>,
        transform: &ImageTransform,
        confidence: f32,
        max_poses: u32,
    ) -> Result<Vec<Pose2D>> {
        let head = self.head.as_ref().context("缺少 PoseNet 输出定义")?;
        let (heatmap, dims) = to_f32(&outputs[head.heatmap_index])?;
        let offsets = to_f32(&outputs[head.offset_index])?.0;

        let heatmap_width = if head.heatmap_nchw { dims[3] } else { dims[2] };
        let heatmap_height = if head.heatmap_nchw { dims[2] } else { dims[1] };

        let config = DecodeConfig {
            confidence_threshold: confidence,
            nms_radius: 20.0,
            max_poses: max_poses.max(1),
            stride: head.stride,
            multi_pose: max_poses > 1,
            heatmap_layout: if head.heatmap_nchw {
                TensorLayout::Nchw
            } else {
                TensorLayout::Nhwc
            },
            offset_layout: if head.heatmap_nchw {
                TensorLayout::Nchw
            } else {
                TensorLayout::Nhwc
            },
            offset_order: spinevext_core::types::OffsetOrder::Yx,
            displacement_layout: TensorLayout::Nhwc,
            // MoveNet 的 offset 以「heatmap 格」为单位（(格 + offset) * stride），
            // 经典 PoseNet 导出的 offset 已经是以模型输入像素为单位。
            offset_in_pixels: self.kind == ModelKind::PoseNet,
            transform: *transform,
        };

        Ok(decode(
            &heatmap,
            &offsets,
            &[],
            &[],
            heatmap_height,
            heatmap_width,
            KEYPOINT_NAMES.len(),
            &config,
        ))
    }
}

/// 阶段性进度：卡在哪一步一眼就能看出来。
fn progress(started: &std::time::Instant, stage: &str) {
    use std::io::Write;
    eprintln!("  · {stage} 完成（{:.2}s）", started.elapsed().as_secs_f32());
    let _ = std::io::stderr().flush();
}

/// 取出静态形状；出现符号维度（动态 batch）时直接报错，避免跑出错位的结果。
fn fact_dims(fact: &TypedFact) -> Result<Vec<usize>> {
    fact.shape
        .as_concrete()
        .map(|shape| shape.to_vec())
        .context("模型含动态维度，请先用 onnxsim 固化形状")
}

/// 取出 f32 数据和形状。
fn to_f32(tensor: &TValue) -> Result<(Vec<f32>, Vec<usize>)> {
    let view = tensor.to_array_view::<f32>()?;
    Ok((view.iter().copied().collect(), view.shape().to_vec()))
}
