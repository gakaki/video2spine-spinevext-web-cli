/**
 * 界面文案表：`key → { 各语言 }`。
 *
 * 只放**界面文案**；算法内核里那些诊断性报错（参数解析失败、ONNX 加载失败之类）
 * 保持原样，它们是给排错看的，不进翻译流程。
 *
 * key 用点分层级、和来源文件一一对应；加语言时照着一列补即可，
 * `tests/i18n.test.ts` 会检查每种语言的 key 是否齐全。
 */

export const LANGUAGES = ["zh-CN", "en", "ja"] as const;

export type Language = (typeof LANGUAGES)[number];

/** 语言选择器上的名字（用各语言自己的写法）。 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  "zh-CN": "中文",
  en: "English",
  ja: "日本語",
};

const DICTS = {
  /* ---------------------------------------------------------------- 外壳 */
  "app.stage.boot": { "zh-CN": "初始化", en: "Booting", ja: "初期化中" },
  "app.stage.idle": { "zh-CN": "待机", en: "Idle", ja: "待機" },
  "app.stage.detecting": { "zh-CN": "检测中", en: "Detecting", ja: "検出中" },
  "app.stage.rendering": { "zh-CN": "拼图集", en: "Packing atlas", ja: "アトラス作成" },
  "app.stage.ready": { "zh-CN": "已完成", en: "Ready", ja: "完成" },
  "app.stage.exporting": { "zh-CN": "导出中", en: "Exporting", ja: "書き出し中" },
  "app.stage.error": { "zh-CN": "出错", en: "Error", ja: "エラー" },
  "app.theme.toLight": {
    "zh-CN": "切换到白天主题",
    en: "Switch to light theme",
    ja: "ライトテーマに切り替え",
  },
  "app.theme.toDark": {
    "zh-CN": "切换到黑夜主题",
    en: "Switch to dark theme",
    ja: "ダークテーマに切り替え",
  },
  "app.language": { "zh-CN": "界面语言", en: "Language", ja: "表示言語" },
  "app.badge.keypoints": { "zh-CN": "17 关键点", en: "17 keypoints", ja: "17 キーポイント" },
  "app.badge.core": { "zh-CN": "Rust 内核", en: "rust core", ja: "rust core" },
  "app.subtitle": {
    "zh-CN": "web · 视频 → Spine 骨骼",
    en: "web · video → spine rig",
    ja: "web · 動画 → Spine リグ",
  },

  /* ------------------------------------------------------------ 左侧控制栏 */
  "control.input.title": { "zh-CN": "输入", en: "Input", ja: "入力" },
  "control.input.desc": {
    "zh-CN": "视频文件或摄像头画面，逐帧送进姿态网络",
    en: "A video file or the webcam, fed to the pose network frame by frame",
    ja: "動画ファイルまたはカメラ映像を 1 フレームずつ姿勢推定へ",
  },
  "control.input.pick": { "zh-CN": "选择视频", en: "Choose video", ja: "動画を選ぶ" },
  "control.input.webcam": { "zh-CN": "摄像头", en: "Webcam", ja: "カメラ" },
  "control.source.name": { "zh-CN": "来源", en: "Source", ja: "ソース" },
  "control.source.resolution": { "zh-CN": "分辨率", en: "Resolution", ja: "解像度" },
  "control.source.frames": { "zh-CN": "采样帧数", en: "Sampled frames", ja: "サンプル数" },
  "control.source.duration": { "zh-CN": "时长", en: "Duration", ja: "長さ" },
  "control.input.empty": {
    "zh-CN": "还没有输入。选择一段有人物全身画面的视频效果最好。",
    en: "Nothing loaded yet. A clip with a full-body subject works best.",
    ja: "まだ入力がありません。全身が映った動画が最適です。",
  },
  "control.sampling.fps": { "zh-CN": "采样帧率", en: "Sample fps", ja: "サンプル fps" },
  "control.sampling.fps.suffix": { "zh-CN": " 帧/秒", en: " fps", ja: " fps" },
  "control.sampling.fps.hint": {
    "zh-CN": "原版是逐帧处理；浏览器里降采样能在几乎不影响骨骼的前提下显著提速。",
    en: "The original tool processed every frame; sampling less speeds the browser up a lot with almost no effect on the rig.",
    ja: "オリジナルは全フレーム処理。間引くとリグへの影響がほぼ無いまま大幅に速くなります。",
  },
  "control.sampling.start": { "zh-CN": "起点", en: "Start", ja: "開始" },
  "control.sampling.end": { "zh-CN": "终点", en: "End", ja: "終了" },
  "control.sampling.seconds": { "zh-CN": " 秒", en: " s", ja: " 秒" },
  "control.sampling.end.hint": {
    "zh-CN": "0 = 一直处理到视频结尾",
    en: "0 = process to the end of the video",
    ja: "0 = 動画の最後まで処理",
  },
  "control.maxWidth": {
    "zh-CN": "处理分辨率上限",
    en: "Max processing width",
    ja: "処理解像度の上限",
  },
  "control.maxWidth.hint": {
    "zh-CN": "仅影响送入网络的分辨率；导出的图集使用同一尺寸。",
    en: "Only affects the resolution fed to the network; the exported atlas uses the same size.",
    ja: "ネットワークへ渡す解像度のみ。書き出すアトラスも同じサイズになります。",
  },
  "control.flipX": { "zh-CN": "水平镜像", en: "Mirror horizontally", ja: "左右反転" },
  "control.flipX.hint": {
    "zh-CN": "自拍视角。镜像在 Rust 预处理里完成，骨骼与画面始终对齐。",
    en: "Selfie view. The flip happens in the Rust preprocessing, so the rig always lines up with the picture.",
    ja: "自撮り視点。反転は Rust の前処理で行うため、リグと映像は常に一致します。",
  },
  "control.detect": { "zh-CN": "开始检测", en: "Start detection", ja: "検出を開始" },
  "control.stop": { "zh-CN": "停止", en: "Stop", ja: "停止" },
  "control.readyFrames": {
    "zh-CN": "已就绪 {count} 帧骨骼数据",
    en: "{count} frames of bone data ready",
    ja: "{count} フレーム分のボーンデータ準備完了",
  },
  "control.params.title": { "zh-CN": "检测参数", en: "Detection", ja: "検出パラメータ" },
  "control.params.desc": {
    "zh-CN": "对应原版 Inspector 上的 confidence / nmsRadius / maxPoses",
    en: "Mirrors confidence / nmsRadius / maxPoses on the original Inspector",
    ja: "オリジナルの Inspector にある confidence / nmsRadius / maxPoses に対応",
  },
  "control.confidence": { "zh-CN": "置信度阈值", en: "Confidence threshold", ja: "信頼度しきい値" },
  "control.maxPoses": { "zh-CN": "最大人数", en: "Max people", ja: "最大人数" },
  "control.maxPoses.hint": {
    "zh-CN": "大于 1 时启用多人解码（贪心聚合 + NMS）",
    en: "Above 1 enables multi-person decoding (greedy grouping + NMS)",
    ja: "2 以上で複数人デコードを有効化（貪欲法 + NMS）",
  },
  "control.nms": { "zh-CN": "NMS 半径", en: "NMS radius", ja: "NMS 半径" },
  "control.smooth": { "zh-CN": "平滑窗口", en: "Smoothing window", ja: "平滑化ウィンドウ" },
  "control.smooth.suffix": { "zh-CN": " 帧", en: " frames", ja: " フレーム" },
  "control.smooth.hint": {
    "zh-CN": "1 = 关闭平滑。角度用圆周平均，跨 ±180° 不会抖动。",
    en: "1 = no smoothing. Angles use circular averaging, so ±180° crossings do not jitter.",
    ja: "1 = 平滑化なし。角度は円周平均なので ±180° をまたいでも暴れません。",
  },
  "control.minKeypoints": {
    "zh-CN": "最少有效关节",
    en: "Min confident joints",
    ja: "有効キーポイントの最小数",
  },
  "control.minKeypoints.suffix": { "zh-CN": " 个", en: "", ja: " 個" },
  "control.minKeypoints.hint": {
    "zh-CN": "低于这个数量的帧会被判定为无效，并用基准帧回填。",
    en: "Frames below this count are treated as invalid and filled from the base frame.",
    ja: "これを下回るフレームは無効とみなし、基準フレームで補います。",
  },
  "control.anim.title": {
    "zh-CN": "动画烘焙",
    en: "Animation baking",
    ja: "アニメーション焼き込み",
  },
  "control.anim.desc": {
    "zh-CN": "对应 GetBaseFrame / PropogateList",
    en: "Mirrors GetBaseFrame / PropogateList",
    ja: "GetBaseFrame / PropogateList に対応",
  },
  "control.baseFrame": { "zh-CN": "基准帧", en: "Base frame", ja: "基準フレーム" },
  "control.baseFrame.auto": { "zh-CN": "自动", en: "Auto", ja: "自動" },
  "control.baseFrame.manual": { "zh-CN": "手动指定", en: "Pick manually", ja: "手動指定" },
  "control.baseFrame.hint": {
    "zh-CN": "自动会挑选骨骼最完整、置信度最高的一帧作为静止姿态。",
    en: "Auto picks the most complete, highest-confidence frame as the rest pose.",
    ja: "自動では最も完全で信頼度の高いフレームを静止姿勢に選びます。",
  },
  "control.baseFrame.index": {
    "zh-CN": "基准帧序号",
    en: "Base frame index",
    ja: "基準フレーム番号",
  },
  "control.propagate": {
    "zh-CN": "无效帧回填",
    en: "Fill invalid frames",
    ja: "無効フレームを補完",
  },
  "control.propagate.hint": {
    "zh-CN": "开启后，骨骼不完整的帧直接复用基准帧的姿态，保证动画连续。",
    en: "Frames with an incomplete rig reuse the base pose, keeping the animation continuous.",
    ja: "オンにすると不完全なフレームは基準姿勢を再利用し、動きが途切れません。",
  },

  /* ------------------------------------------------------------ 中间舞台 */
  "stage.frames": { "zh-CN": "{count} 帧", en: "{count} frames", ja: "{count} フレーム" },
  "stage.liveMs": {
    "zh-CN": "实时 {ms} ms/帧",
    en: "live {ms} ms/frame",
    ja: "リアルタイム {ms} ms/フレーム",
  },
  "stage.keypoints": { "zh-CN": "关键点", en: "Keypoints", ja: "キーポイント" },
  "stage.bones": { "zh-CN": "骨架", en: "Bones", ja: "ボーン" },
  "stage.videoPane": {
    "zh-CN": "视频 / 摄像头 + 骨架",
    en: "Video / webcam + bones",
    ja: "映像 / カメラ + ボーン",
  },
  "stage.characterPane": {
    "zh-CN": "Spine 演示角色 · 实时跟随",
    en: "Spine character · live follow",
    ja: "Spine キャラ · リアルタイム追従",
  },
  "stage.prevFrame": { "zh-CN": "上一帧", en: "Previous frame", ja: "前のフレーム" },
  "stage.nextFrame": { "zh-CN": "下一帧", en: "Next frame", ja: "次のフレーム" },
  "stage.play": { "zh-CN": "播放", en: "Play", ja: "再生" },
  "stage.pause": { "zh-CN": "暂停", en: "Pause", ja: "一時停止" },
  "stage.live": { "zh-CN": "实时", en: "live", ja: "リアルタイム" },
  "stage.baseFrame": {
    "zh-CN": "基准帧 #{index}",
    en: "base frame #{index}",
    ja: "基準フレーム #{index}",
  },
  "stage.phase.pose": { "zh-CN": "姿态估计", en: "Pose estimation", ja: "姿勢推定" },
  "stage.phase.rig": { "zh-CN": "骨骼烘焙", en: "Bone baking", ja: "ボーン焼き込み" },
  "stage.phase.atlas": { "zh-CN": "拼图集", en: "Packing atlas", ja: "アトラス作成" },
  "stage.tip": {
    "zh-CN":
      "提示：先在左侧载入视频或开启摄像头。左屏是画面实时预览，右屏的 Spine 角色会跟着人动；点「开始检测」后还能逐帧检查并导出成 Spine 工程。",
    en: "Tip: load a video or open the webcam on the left. The left pane is the live picture, the right one is a Spine character following you; after “Start detection” you can scrub frames and export a Spine project.",
    ja: "ヒント：まず左側で動画を読み込むかカメラを起動してください。左は映像、右は人に追従する Spine キャラです。「検出を開始」後はフレームを確認して Spine プロジェクトとして書き出せます。",
  },
  "stage.validity.frame": {
    "zh-CN": "第 {index} 帧",
    en: "Frame {index}",
    ja: "{index} フレーム目",
  },
  "stage.validity.incomplete": {
    "zh-CN": "（骨骼不完整）",
    en: " (incomplete rig)",
    ja: "（ボーン不完全）",
  },

  /* ---------------------------------------------------------- 演示角色舞台 */
  "character.loading": {
    "zh-CN": "正在加载演示角色…",
    en: "Loading the demo character…",
    ja: "デモキャラを読み込み中…",
  },
  "character.none": {
    "zh-CN": "未检测到人体 · {state}",
    en: "No person detected · {state}",
    ja: "人物を検出していません · {state}",
  },
  "character.idlePlaying": { "zh-CN": "播放待机动画", en: "playing idle", ja: "待機モーション" },
  "character.idleStatic": {
    "zh-CN": "保持静止姿态",
    en: "holding a static pose",
    ja: "静止姿勢を保持",
  },
  "character.picker": { "zh-CN": "演示角色", en: "Demo character", ja: "デモキャラ" },
  "character.name.spineboy": { "zh-CN": "Spineboy", en: "Spineboy", ja: "Spineboy" },
  "character.picker.hint": {
    "zh-CN": "在右侧「导出」面板可以上传自己的 Spine 角色工程",
    en: "Upload your own Spine project in the Export panel on the right",
    ja: "右の「書き出し」パネルから自分の Spine プロジェクトを読み込めます",
  },
  "character.zoom": { "zh-CN": "角色缩放", en: "Character zoom", ja: "キャラの拡大率" },
  "character.rigNote": {
    "zh-CN":
      "角色的 {bones} 骨骼由视频姿态实时驱动（加法式局部旋转重定向）；没有检测到人体时播它自己的待机动画。当前映射 {mapped} / {total} 根骨骼。",
    en: "The character’s {bones} bones are driven live by the video pose (additive local-rotation retargeting); when nobody is detected it plays its own idle animation. {mapped} of {total} bones mapped.",
    ja: "キャラの {bones} ボーンを映像の姿勢でリアルタイム駆動（加算的なローカル回転リターゲット）。人物が無いときは固有の待機モーションを再生します。現在 {mapped} / {total} 本をマッピング。",
  },
  "canvas.placeholder": {
    "zh-CN": "载入视频或开启摄像头后，这里实时显示画面与骨架",
    en: "Load a video or start the webcam and the live picture with bones shows up here",
    ja: "動画を読み込むかカメラを起動すると、ここに映像とボーンが表示されます",
  },
  "canvas.signalWaiting": { "zh-CN": "等待信号中…", en: "signal · waiting", ja: "signal · 待機中" },

  /* ------------------------------------------------------------ 导出面板 */
  "export.title": { "zh-CN": "导出", en: "Export", ja: "書き出し" },
  "export.desc": {
    "zh-CN": "角色工程出「角色美术 + 视频检测出的骨骼动画」；视频帧图集把每帧画面做成 region",
    en: "A character project gives you the character’s art plus the bone animation detected from the video; the frame atlas turns every video frame into a region",
    ja: "キャラクタープロジェクトはキャラの美術＋動画から検出したボーンアニメ、フレームアトラスは各フレームを region にします",
  },
  "export.mode": { "zh-CN": "导出内容", en: "Export as", ja: "書き出す内容" },
  "export.mode.character": { "zh-CN": "角色工程", en: "Character project", ja: "キャラクター" },
  "export.mode.frames": { "zh-CN": "视频帧图集", en: "Video frame atlas", ja: "フレームアトラス" },
  "export.mode.character.hint": {
    "zh-CN": "骨架与美术来自角色，动画来自刚才检测出的骨骼角度（重定向后写成 rotate 时间轴）。",
    en: "Skeleton and art come from the character; the animation is the bone angles just detected, retargeted into rotate timelines.",
    ja: "骨格と美術はキャラのもの、アニメは今検出したボーン角度をリターゲットして rotate トラックに書きます。",
  },
  "export.mode.frames.hint": {
    "zh-CN": "把视频每一帧当成一个 region 附件，动画只切附件，不含骨骼旋转。",
    en: "Every video frame becomes a region attachment; the animation only swaps attachments, with no bone rotation.",
    ja: "各フレームを region アタッチメントにし、アニメはアタッチメントの差し替えのみ（ボーン回転なし）。",
  },
  "export.character": { "zh-CN": "导出角色", en: "Character", ja: "書き出すキャラ" },
  "export.character.hint": {
    "zh-CN": "左侧舞台上的实时预览会同步切到同一个角色。",
    en: "The live preview on the left switches to the same character.",
    ja: "左側のプレビューも同じキャラに切り替わります。",
  },
  "export.upload": {
    "zh-CN": "上传自己的 Spine 工程",
    en: "Upload your own Spine project",
    ja: "自分の Spine プロジェクトを読み込む",
  },
  "export.upload.button": {
    "zh-CN": "选择 zip 或 json + atlas + png",
    en: "Choose a zip or json + atlas + png",
    ja: "zip か json + atlas + png を選ぶ",
  },
  "export.upload.loading": { "zh-CN": "正在载入…", en: "Loading…", ja: "読み込み中…" },
  "export.upload.hint": {
    "zh-CN":
      "可以直接丢一个 zip，也可以多选骨架 JSON、.atlas 和图集图片；骨骼名带 torso / head / arm-l / leg-r、front-upper-arm / rear-thigh、upperArm.L / upperLeg.R 都能自动认出来。",
    en: "Drop a single zip, or pick the skeleton JSON, .atlas and atlas images together. Bone names like torso / head / arm-l / leg-r, front-upper-arm / rear-thigh and upperArm.L / upperLeg.R are recognised automatically.",
    ja: "zip を 1 つでも、骨格 JSON・.atlas・画像をまとめて選んでも OK。torso / head / arm-l / leg-r、front-upper-arm / rear-thigh、upperArm.L / upperLeg.R といった名前を自動認識します。",
  },
  "export.name": { "zh-CN": "工程名", en: "Project name", ja: "プロジェクト名" },
  "export.animation": { "zh-CN": "动画名", en: "Animation name", ja: "アニメ名" },
  "export.animation.hint": {
    "zh-CN": "动作用的名字，默认跟着载入的视频文件名走；写成 idle/breathe 这样带斜杠的名字也能用。",
    en: "Name of the animation. It defaults to the loaded video’s file name; names with slashes such as idle/breathe work too.",
    ja: "アニメの名前。既定では読み込んだ動画のファイル名になります。idle/breathe のようなスラッシュ入りも可。",
  },
  "export.atlasScale": { "zh-CN": "图集缩放", en: "Atlas scale", ja: "アトラス倍率" },
  "export.atlasScale.hint": {
    "zh-CN": "缩小图集能显著降低体积，骨骼数据不受影响。",
    en: "Shrinking the atlas cuts the file size a lot; bone data is unaffected.",
    ja: "縮小するとサイズが大幅に減り、ボーンデータには影響しません。",
  },
  "export.atlasWidth": { "zh-CN": "图集最大宽度", en: "Max atlas width", ja: "アトラス最大幅" },
  "export.atlasPadding": { "zh-CN": "图集间隙", en: "Atlas padding", ja: "アトラス余白" },
  "export.atlasPadding.hint": {
    "zh-CN": "相邻帧之间留一点空隙，避免缩放采样时出现边缘渗色。",
    en: "A little space between frames avoids edge bleeding when the atlas is scaled.",
    ja: "フレーム間に余白を入れると、縮小時の色にじみを防げます。",
  },
  "export.preview.title": { "zh-CN": "导出预览", en: "Export preview", ja: "書き出しプレビュー" },
  "export.readout.character": { "zh-CN": "角色", en: "Character", ja: "キャラ" },
  "export.readout.character.none": { "zh-CN": "未选择", en: "not selected", ja: "未選択" },
  "export.readout.mappedBones": {
    "zh-CN": "映射骨骼",
    en: "Mapped bones",
    ja: "マッピング済みボーン",
  },
  "export.readout.mappedBones.value": { "zh-CN": "{count} 根", en: "{count}", ja: "{count} 本" },
  "export.readout.animation": { "zh-CN": "动画", en: "Animation", ja: "アニメ" },
  "export.readout.framesDuration": {
    "zh-CN": "帧数 / 时长",
    en: "Frames / length",
    ja: "フレーム / 長さ",
  },
  "export.readout.detectedBones": { "zh-CN": "检测骨骼", en: "Detected bones", ja: "検出ボーン" },
  "export.readout.frames": { "zh-CN": "帧数", en: "Frames", ja: "フレーム数" },
  "export.readout.frameSize": { "zh-CN": "单帧尺寸", en: "Frame size", ja: "フレームサイズ" },
  "export.readout.atlasSize": { "zh-CN": "图集尺寸", en: "Atlas size", ja: "アトラスサイズ" },
  "export.readout.atlasBytes": {
    "zh-CN": "图集体积（未压缩）",
    en: "Atlas size (uncompressed)",
    ja: "アトラス容量（非圧縮）",
  },
  "export.readout.skeletonBones": { "zh-CN": "骨骼数量", en: "Bone count", ja: "ボーン数" },
  "export.note.character": {
    "zh-CN":
      "导出的是角色自己的 JSON / atlas / PNG，只把视频检测到的骨骼角度写进 animations.{animation}.bones.*.rotate。",
    en: "The export contains the character’s own JSON / atlas / PNG; only the detected bone angles are written into animations.{animation}.bones.*.rotate.",
    ja: "書き出すのはキャラ自身の JSON / atlas / PNG。検出したボーン角度だけを animations.{animation}.bones.*.rotate に書きます。",
  },
  "export.tooBig": {
    "zh-CN": "图集超过 512 MiB，浏览器很可能编码失败。请降低图集缩放或减少采样帧数。",
    en: "The atlas is over 512 MiB and the browser will likely fail to encode it. Lower the atlas scale or sample fewer frames.",
    ja: "アトラスが 512 MiB を超えるとブラウザでのエンコードが失敗しがちです。倍率を下げるかフレーム数を減らしてください。",
  },
  "export.submit.character": {
    "zh-CN": "导出角色 Spine 工程",
    en: "Export character Spine project",
    ja: "キャラの Spine プロジェクトを書き出す",
  },
  "export.submit.frames": {
    "zh-CN": "导出视频帧 Spine 工程",
    en: "Export video-frame Spine project",
    ja: "フレームの Spine プロジェクトを書き出す",
  },
  "export.submit.busy": { "zh-CN": "正在导出…", en: "Exporting…", ja: "書き出し中…" },
  "export.needDetect": {
    "zh-CN": "先完成一次检测，导出按钮才会启用。",
    en: "Run a detection first to enable the export button.",
    ja: "先に検出を 1 回実行すると書き出せます。",
  },

  /* ------------------------------------------------------------ Spine 预览 */
  "preview.loading": {
    "zh-CN": "正在启动 Spine 运行时…",
    en: "Starting the Spine runtime…",
    ja: "Spine ランタイムを起動中…",
  },
  "preview.rewind": { "zh-CN": "回到开头", en: "Back to start", ja: "先頭に戻る" },
  "preview.stale": {
    "zh-CN": "参数已改，重新生成",
    en: "Settings changed — rebuild",
    ja: "設定が変わったので再生成",
  },
  "preview.speed": { "zh-CN": "播放速度", en: "Playback speed", ja: "再生速度" },
  "preview.zoom": { "zh-CN": "画面缩放", en: "View zoom", ja: "表示倍率" },
  "preview.note": {
    "zh-CN":
      "预览用的是导出 zip 里那份 Spine 4.3 JSON + Atlas + 图集 PNG，由官方运行时实时播放。图集只拼一次，导出时直接复用。",
    en: "The preview plays exactly the Spine 4.3 JSON + atlas + atlas PNG from the exported zip, using the official runtime. The atlas is packed once and reused for the download.",
    ja: "プレビューは書き出す zip と同じ Spine 4.3 JSON + atlas + PNG を公式ランタイムで再生しています。アトラスは 1 度だけ作成し、書き出しでも再利用します。",
  },

  /* ------------------------------------------------------------ 状态栏消息 */
  "msg.booting": {
    "zh-CN": "正在初始化 Rust 内核…",
    en: "Starting the Rust core…",
    ja: "Rust コアを初期化中…",
  },
  "msg.loading": { "zh-CN": "正在加载…", en: "Loading…", ja: "読み込み中…" },
  "msg.loadingModel": {
    "zh-CN": "正在加载姿态模型…",
    en: "Loading the pose model…",
    ja: "姿勢モデルを読み込み中…",
  },
  "msg.ready": {
    "zh-CN": "就绪：载入一段视频或开启摄像头",
    en: "Ready: load a video or start the webcam",
    ja: "準備完了：動画を読み込むかカメラを起動してください",
  },
  "msg.initFailed": { "zh-CN": "初始化失败", en: "Initialisation failed", ja: "初期化に失敗" },
  "msg.sourceLoaded": {
    "zh-CN": "已载入 {name}：{count} 帧待检测",
    en: "Loaded {name}: {count} frames to detect",
    ja: "{name} を読み込みました：{count} フレームを検出します",
  },
  "msg.parsingVideo": { "zh-CN": "正在解析视频…", en: "Reading the video…", ja: "動画を解析中…" },
  "msg.recording": {
    "zh-CN": "正在录制 {seconds} 秒摄像头画面…",
    en: "Recording {seconds} seconds from the webcam…",
    ja: "カメラから {seconds} 秒録画中…",
  },
  "msg.webcam": { "zh-CN": "摄像头", en: "Webcam", ja: "カメラ" },
  "msg.buildingAtlas": {
    "zh-CN": "正在拼图集，准备 Spine 预览…",
    en: "Packing the atlas for the Spine preview…",
    ja: "Spine プレビュー用にアトラスを作成中…",
  },
  "msg.previewReady": {
    "zh-CN": "Spine 预览就绪：图集 {width}×{height}，可以在预览页实时播放",
    en: "Spine preview ready: atlas {width}×{height}, playable live in the preview pane",
    ja: "Spine プレビュー準備完了：アトラス {width}×{height}、プレビューで再生できます",
  },
  "msg.detecting": {
    "zh-CN": "正在逐帧估计姿态…",
    en: "Estimating the pose frame by frame…",
    ja: "1 フレームずつ姿勢を推定中…",
  },
  "msg.detected": {
    "zh-CN": "检测完成：{frames} 帧，其中 {valid} 帧骨骼完整（基准帧 #{base}）",
    en: "Detection done: {frames} frames, {valid} with a complete rig (base frame #{base})",
    ja: "検出完了：{frames} フレーム中 {valid} フレームが完全（基準フレーム #{base}）",
  },
  "msg.cancelled": {
    "zh-CN": "已取消检测",
    en: "Detection cancelled",
    ja: "検出をキャンセルしました",
  },
  "msg.baking": {
    "zh-CN": "正在把视频动作烘焙到角色骨骼上…",
    en: "Baking the video motion onto the character’s bones…",
    ja: "動画の動きをキャラのボーンへ焼き込み中…",
  },
  "msg.exporting": {
    "zh-CN": "正在准备导出…",
    en: "Preparing the export…",
    ja: "書き出しを準備中…",
  },
  "msg.exported.character": {
    "zh-CN":
      "已导出角色工程 {name}.zip：{bones} 根骨骼 × {frames} 帧动画，图集 {pages} 页（角色：{character}{renamed}）",
    en: "Exported character project {name}.zip: {bones} bones × {frames} frames, atlas {pages} page(s) — character: {character}{renamed}",
    ja: "キャラプロジェクト {name}.zip を書き出しました：{bones} ボーン × {frames} フレーム、アトラス {pages} ページ（キャラ：{character}{renamed}）",
  },
  "msg.exported.character.renamed": {
    "zh-CN": "，{count} 个中文部位名已转英文",
    en: ", {count} non-ASCII part names renamed",
    ja: "、{count} 個の非 ASCII 部位名を変換",
  },
  "msg.exported.frames": {
    "zh-CN": "已导出 {name}.zip：Spine 4.3 JSON + Atlas + {width}×{height} 图集",
    en: "Exported {name}.zip: Spine 4.3 JSON + atlas + {width}×{height} image",
    ja: "{name}.zip を書き出しました：Spine 4.3 JSON + atlas + {width}×{height}",
  },
  "msg.characterLoaded": {
    "zh-CN": "已载入自定义角色「{name}」：映射了 {count} 根骨骼",
    en: "Loaded custom character “{name}”: {count} bones mapped",
    ja: "カスタムキャラ「{name}」を読み込み：{count} ボーンをマッピング",
  },
  "msg.characterFailed": {
    "zh-CN": "角色载入失败：{error}",
    en: "Character failed to load: {error}",
    ja: "キャラの読み込みに失敗：{error}",
  },
  "msg.needCharacter": {
    "zh-CN": "请先上传一个 Spine 角色工程（zip 或 json + atlas + png）",
    en: "Upload a Spine character project first (zip, or json + atlas + png)",
    ja: "先に Spine プロジェクトを読み込んでください（zip か json + atlas + png）",
  },
} as const satisfies Record<string, Record<Language, string>>;

export const DICTIONARY: Record<string, Record<Language, string>> = DICTS;

export type MessageKey = keyof typeof DICTS;
