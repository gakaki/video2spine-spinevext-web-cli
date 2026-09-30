//! Spine 4.3 JSON 导出。
//!
//! 对应原版 `Assets/JSONModels/Spine.cs` 里的 `Spine / Skeleton / Bone /
//! Slot / Skin / SkinAttachment / Animation / AnimationAction / Animations`
//! 一整套数据模型。
//!
//! 格式版本跟着官方 npm 运行时走（`@esotericsoftware/spine-webgl` 目前是 4.3），
//! 这样导出的工程既能被 Spine 编辑器打开，也能在浏览器里用官方运行时实时播放。
//! 4.x 与 3.8 的差异集中在三处：`skins` 从对象变成数组、附件要显式写 `type`、
//! 骨骼旋转时间轴的键名从 `angle` 改成 `value`。
//!
//! 设计要点：
//! * 骨骼树来自 `AnimationData.skeleton`，静止姿态取基准帧；
//! * 每条 `rotate` 时间轴记录该骨骼的**局部旋转角**，逐帧一个关键帧；
//! * 所有视频帧作为 region 附件放进 `default` 皮肤，动画用
//!   `slots.<slot>.attachment` 时间轴逐帧切换附件；于是 Spine 里播放动画
//!   就等于播放原视频，同时骨架跟随姿态运动。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::animate::AnimationData;

/// 帧附件所在的 slot 名。
pub const FRAME_SLOT: &str = "video";
/// 默认皮肤名。
pub const DEFAULT_SKIN: &str = "default";

/// 写入 `skeleton.spine` 的格式版本号。
///
/// 锁定在 4.3.23：官方 TS 运行时只是把这个值记下来
/// （`SkeletonData.version`，源码里没有任何版本比对），
/// 4.3 的运行时读 4.3.x 的数据既不会报警也不会报错；
/// 但下游工程、审核和复现都希望看到**固定**的一个版本号，
/// 所以这里不跟着 npm 运行时依赖的 patch 号漂。
///
/// 这是全仓库唯一的版本事实来源：TS 侧通过绑定读 `spineVersion()`，
/// 不再自己写一份。
pub const SPINE_VERSION: &str = "4.3.23";

/// 导出参数。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportConfig {
    /// 工程名，用于文件命名与 hash。
    pub name: String,
    /// 动画名。
    pub animation_name: String,
    pub frame_width: f32,
    pub frame_height: f32,
    pub frame_count: u32,
    pub fps: f32,
    /// 帧附件名前缀，最终形如 `frame_0000`。
    pub region_prefix: String,
    /// 图集图片名（atlas 内引用、png 文件名）。
    pub image_name: String,
    /// 视频帧在图集里的缩放（1 = 原始尺寸）。
    pub image_scale: f32,
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            name: "spinevext".to_string(),
            animation_name: "video".to_string(),
            frame_width: 1920.0,
            frame_height: 1080.0,
            frame_count: 0,
            fps: 30.0,
            region_prefix: "frame_".to_string(),
            image_name: "spinevext.png".to_string(),
            image_scale: 1.0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkeletonMeta {
    hash: String,
    spine: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    images: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoneJson {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent: Option<String>,
    length: f32,
    x: f32,
    y: f32,
    rotation: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlotJson {
    name: String,
    bone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegionJson {
    /// Spine 4.x 要求显式声明附件类型。
    #[serde(rename = "type")]
    kind: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

/// Spine 4.x 的皮肤是数组元素（3.8 里是"皮肤名 → 槽位"的对象映射）。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkinJson {
    name: String,
    attachments: BTreeMap<String, BTreeMap<String, RegionJson>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentKeyframe {
    time: f32,
    /// Spine 的 attachment 时间轴用 `name` 字段。
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RotateKeyframe {
    time: f32,
    /// Spine 4.x 的 rotate 时间轴用 `value` 表示角度。
    value: f32,
}

#[derive(Debug, Serialize, Deserialize)]
struct SlotAnimation {
    attachment: Vec<AttachmentKeyframe>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BoneAnimation {
    rotate: Vec<RotateKeyframe>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AnimationJson {
    slots: BTreeMap<String, SlotAnimation>,
    bones: BTreeMap<String, BoneAnimation>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SpineJson {
    skeleton: SkeletonMeta,
    bones: Vec<BoneJson>,
    slots: Vec<SlotJson>,
    skins: Vec<SkinJson>,
    animations: BTreeMap<String, AnimationJson>,
}

/// `frame_0000` 形式的附件名。
pub fn region_name(prefix: &str, index: usize) -> String {
    format!("{prefix}{index:04}")
}

/// 生成一段稳定 hash，便于在 Spine 里辨认导出批次。
fn content_hash(cfg: &ExportConfig) -> String {
    let raw = format!(
        "{}|{}|{}x{}|{}|{}",
        cfg.name, cfg.animation_name, cfg.frame_width, cfg.frame_height, cfg.frame_count, cfg.fps
    );
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in raw.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

/// 把烘焙好的动画写成 Spine 3.8 JSON 字符串。
pub fn build_spine_json(anim: &AnimationData, cfg: &ExportConfig) -> Result<String, String> {
    let frame_count = if cfg.frame_count == 0 {
        anim.frames.len()
    } else {
        cfg.frame_count as usize
    };
    if frame_count == 0 {
        return Err("没有可导出的帧".to_string());
    }
    let fps = if cfg.fps > 0.0 {
        cfg.fps
    } else {
        anim.fps.max(1.0)
    };
    let scale = if cfg.image_scale > 0.0 {
        cfg.image_scale
    } else {
        1.0
    };

    // 骨骼：静止姿态取基准帧；根骨骼摆到"画面中心为原点"的位置，
    // 因为 Spine 的 region 附件默认以中心对齐。
    let half_w = cfg.frame_width * 0.5;
    let half_h = cfg.frame_height * 0.5;
    let bones: Vec<BoneJson> = anim
        .skeleton
        .iter()
        .enumerate()
        .map(|(index, bone)| BoneJson {
            name: bone.name.clone(),
            parent: bone.parent.clone(),
            length: bone.length,
            x: if index == 0 {
                anim.root_x - half_w
            } else {
                bone.x
            },
            y: if index == 0 {
                anim.root_y - half_h
            } else {
                bone.y
            },
            rotation: bone.rotation,
        })
        .collect();

    // 皮肤：每帧一个 region，全部对齐到画面中心。
    let mut regions: BTreeMap<String, RegionJson> = BTreeMap::new();
    for index in 0..frame_count {
        regions.insert(
            region_name(&cfg.region_prefix, index),
            RegionJson {
                kind: "region".to_string(),
                x: 0.0,
                y: 0.0,
                width: cfg.frame_width * scale,
                height: cfg.frame_height * scale,
            },
        );
    }
    let mut slot_map: BTreeMap<String, BTreeMap<String, RegionJson>> = BTreeMap::new();
    slot_map.insert(FRAME_SLOT.to_string(), regions);
    let skins = vec![SkinJson {
        name: DEFAULT_SKIN.to_string(),
        attachments: slot_map,
    }];

    // 动画：slot 逐帧切附件 + 每根骨骼的 rotate 时间轴
    let mut attachment: Vec<AttachmentKeyframe> = (0..frame_count)
        .map(|index| AttachmentKeyframe {
            time: index as f32 / fps,
            name: region_name(&cfg.region_prefix, index),
        })
        .collect();
    // 循环播放时能自然回到第一帧
    attachment.push(AttachmentKeyframe {
        time: frame_count as f32 / fps,
        name: region_name(&cfg.region_prefix, 0),
    });
    let mut slots = BTreeMap::new();
    slots.insert(FRAME_SLOT.to_string(), SlotAnimation { attachment });

    let mut bone_timelines: BTreeMap<String, BoneAnimation> = BTreeMap::new();
    for (bone_index, bone) in anim.skeleton.iter().enumerate() {
        let rotate: Vec<RotateKeyframe> = anim
            .frames
            .iter()
            .enumerate()
                .map(|(frame_index, frame)| RotateKeyframe {
                    time: frame_index as f32 / fps,
                    value: frame.get(bone_index).copied().unwrap_or(0.0),
                })
                .collect();
        // 从头到尾都是 0 的曲线没有导出价值，跳过以免 Spine 里出现无用轨道
        let animated = rotate.iter().any(|key| key.value.abs() > 1e-6);
        if animated || bone.name == "torso" {
            bone_timelines.insert(bone.name.clone(), BoneAnimation { rotate });
        }
    }

    let mut animations = BTreeMap::new();
    animations.insert(
        cfg.animation_name.clone(),
        AnimationJson {
            slots,
            bones: bone_timelines,
        },
    );

    let json = SpineJson {
        skeleton: SkeletonMeta {
            hash: content_hash(cfg),
            spine: SPINE_VERSION.to_string(),
            x: 0.0,
            y: 0.0,
            width: cfg.frame_width * scale,
            height: cfg.frame_height * scale,
            images: "./".to_string(),
        },
        bones,
        slots: vec![SlotJson {
            name: FRAME_SLOT.to_string(),
            bone: "root".to_string(),
            attachment: Some(region_name(&cfg.region_prefix, 0)),
        }],
        skins,
        animations,
    };

    serde_json::to_string_pretty(&json).map_err(|error| error.to_string())
}
