//! 把 MoveNet 导出图尾部的「后处理段」剪掉，只保留 heatmap / offset 两个卷积输出。
//!
//! 为什么要剪：
//! MoveNet 的 ONNX 由 tf2onnx 导出，图尾包含 `ArgMax` / `GatherNd` /
//! 依赖运行结果的 `Reshape`、`floordiv`、`mul` 等算子。tract 在做类型与
//! 形状推导时会把这类数据相关形状展开成巨大的表达式——实测 9.4MB 的模型
//! 把进程顶到 24GB 内存、把系统打进交换区，几分钟都结束不了。
//!
//! 剪掉尾部之后：
//! * 图里只剩标准卷积主干，tract 秒级完成推导；
//! * 输出变成 heatmap(`[1,H,W,17]`) + offset(`[1,H,W,34]`)，
//!   正好是 `spinevext-core::decode` 已经支持的形式。
//!
//! 这里手写了一个极小的 protobuf 读写器：只做字段级增删，其余字节原样保留，
//! 避免为了剪图引入完整的 ONNX 依赖。

use anyhow::{bail, Context, Result};

/// 需要保留为图输出的两个张量（按节点名匹配）。
const HEATMAP_NODE: &str = "kpt_heatmap_0/conv2d_5/BiasAdd";
const OFFSET_NODE: &str = "kpt_offset_0/conv2d_7/BiasAdd";
/// 主干第一个卷积（tf2onnx 把 NHWC 转成 NCHW 之后就进这里）。
const FIRST_CONV_NODE: &str = "Conv1/Conv2D";

/// 一个已编码的 protobuf 字段。
struct Field<'a> {
    number: u32,
    payload: &'a [u8],
    /// wire type 0 的数值（其它 wire type 为 None）
    varint: Option<u64>,
    /// 含 tag 与长度前缀的完整字节，用于原样回写。
    encoded: &'a [u8],
}

fn read_varint(buf: &[u8], cursor: &mut usize) -> Result<u64> {
    let mut value = 0u64;
    let mut shift = 0u32;
    loop {
        let byte = *buf.get(*cursor).context("varint 越界")?;
        *cursor += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
        if shift > 63 {
            bail!("varint 过长");
        }
    }
}

/// 把一条消息拆成字段列表。
fn split<'a>(buf: &'a [u8]) -> Result<Vec<Field<'a>>> {
    let mut fields = Vec::new();
    let mut cursor = 0usize;
    while cursor < buf.len() {
        let start = cursor;
        let key = read_varint(buf, &mut cursor)?;
        let number = (key >> 3) as u32;
        let wire = (key & 7) as u8;
        let mut varint_value = None;
        let payload: &[u8] = match wire {
            0 => {
                varint_value = Some(read_varint(buf, &mut cursor)?);
                &[]
            }
            1 => {
                cursor += 8;
                &[]
            }
            5 => {
                cursor += 4;
                &[]
            }
            2 => {
                let len = read_varint(buf, &mut cursor)? as usize;
                let payload = buf.get(cursor..cursor + len).context("字段负载越界")?;
                cursor += len;
                payload
            }
            other => bail!("不支持的 protobuf wire type {other}"),
        };
        fields.push(Field {
            number,
            payload,
            varint: varint_value,
            encoded: &buf[start..cursor],
        });
    }
    Ok(fields)
}

fn write_varint(mut value: u64, out: &mut Vec<u8>) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

/// 编码一个 wire type 2 字段。
fn write_bytes_field(number: u32, payload: &[u8], out: &mut Vec<u8>) {
    write_varint(((number as u64) << 3) | 2, out);
    write_varint(payload.len() as u64, out);
    out.extend_from_slice(payload);
}

/// 单独编码一个字段。
fn encode_field(number: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    write_bytes_field(number, payload, &mut out);
    out
}

fn field_as_str<'a>(field: &'a Field<'a>) -> Option<&'a str> {
    std::str::from_utf8(field.payload).ok()
}

/// 节点信息：名字、算子类型、输入、输出。
struct Node<'a> {
    name: String,
    op_type: String,
    inputs: Vec<String>,
    outputs: Vec<String>,
    encoded: &'a [u8],
}

fn parse_node<'a>(encoded: &'a [u8], payload: &[u8]) -> Result<Node<'a>> {
    let mut name = String::new();
    let mut op_type = String::new();
    let mut inputs = Vec::new();
    let mut outputs = Vec::new();
    for field in split(payload)? {
        match field.number {
            1 => {
                if let Some(value) = field_as_str(&field) {
                    inputs.push(value.to_string());
                }
            }
            2 => {
                if let Some(value) = field_as_str(&field) {
                    outputs.push(value.to_string());
                }
            }
            // NodeProto: 3 = name, 4 = op_type
            3 => {
                if let Some(value) = field_as_str(&field) {
                    name = value.to_string();
                }
            }
            4 => {
                if let Some(value) = field_as_str(&field) {
                    op_type = value.to_string();
                }
            }
            _ => {}
        }
    }
    Ok(Node {
        name,
        op_type,
        inputs,
        outputs,
        encoded,
    })
}

/// 构造一个声明了元素类型与具体形状的 ValueInfoProto（float32）。
fn value_info(name: &str, dims: &[u64]) -> Vec<u8> {
    let mut tensor_type = Vec::new();
    write_varint(1 << 3, &mut tensor_type); // elem_type
    write_varint(1, &mut tensor_type); // FLOAT

    let mut tensor_shape = Vec::new();
    for dim in dims {
        let mut dimension = Vec::new();
        write_varint(1 << 3, &mut dimension); // dim_value
        write_varint(*dim, &mut dimension);
        write_bytes_field(1, &dimension, &mut tensor_shape);
    }
    write_bytes_field(2, &tensor_shape, &mut tensor_type); // shape

    let mut type_proto = Vec::new();
    write_bytes_field(1, &tensor_type, &mut type_proto);

    let mut info = Vec::new();
    write_bytes_field(1, name.as_bytes(), &mut info);
    write_bytes_field(2, &type_proto, &mut info);
    info
}

/// 声明成 float32 的输入 ValueInfo。
fn input_value_info(name: &str, dims: &[u64]) -> Vec<u8> {
    value_info(name, dims)
}

/// 读取图输入（NHWC）的 H/W。MoveNet 的输出是输入的 1/4 分辨率。
fn input_spatial(graph_fields: &[Field<'_>]) -> Option<(u64, u64)> {
    for field in graph_fields {
        if field.number != 11 {
            continue;
        }
        let dims = value_info_dims(field.payload);
        // NHWC：dims = [N, H, W, C]
        if dims.len() == 4 {
            return Some((dims[1], dims[2]));
        }
    }
    None
}

/// 从 ValueInfoProto 里读出各维度的具体值。
///
/// 结构：ValueInfo.type(2) → TypeProto.tensor_type(1) → Tensor.shape(2)
/// → TensorShapeProto.dim(1) → Dimension.dim_value(1, varint)
fn value_info_dims(payload: &[u8]) -> Vec<u64> {
    let mut dims = Vec::new();
    let Ok(info_fields) = split(payload) else {
        return dims;
    };
    for info in info_fields {
        if info.number != 2 {
            continue;
        }
        let Ok(type_fields) = split(info.payload) else {
            continue;
        };
        for type_field in type_fields {
            if type_field.number != 1 {
                continue;
            }
            let Ok(tensor_fields) = split(type_field.payload) else {
                continue;
            };
            for tensor_field in tensor_fields {
                if tensor_field.number != 2 {
                    continue;
                }
                let Ok(shape_fields) = split(tensor_field.payload) else {
                    continue;
                };
                for shape_field in shape_fields {
                    if shape_field.number != 1 {
                        continue;
                    }
                    let Ok(dimension_fields) = split(shape_field.payload) else {
                        continue;
                    };
                    let value = dimension_fields
                        .iter()
                        .find(|dimension_field| dimension_field.number == 1)
                        .and_then(|dimension_field| dimension_field.varint)
                        .unwrap_or(0);
                    dims.push(value);
                }
            }
        }
    }
    dims
}

fn find_graph(bytes: &[u8]) -> Result<Option<&[u8]>> {
    for field in split(bytes)? {
        if field.number == 7 {
            return Ok(Some(field.payload));
        }
    }
    Ok(None)
}

/// ValueInfoProto 的名字（字段 1）。
fn value_info_name(payload: &[u8]) -> Option<String> {
    for field in split(payload).ok()? {
        if field.number == 1 {
            return field_as_str(&field).map(str::to_string);
        }
    }
    None
}

/// 这个模型是不是需要剪尾的 MoveNet 导出图。
pub fn needs_trim(bytes: &[u8]) -> Result<bool> {
    let Some(graph) = find_graph(bytes)? else {
        return Ok(false);
    };
    let mut heatmap = false;
    let mut offset = false;
    for field in split(graph)? {
        if field.number != 1 {
            continue;
        }
        let node = parse_node(field.encoded, field.payload)?;
        if node.name.contains(HEATMAP_NODE) {
            heatmap = true;
        }
        if node.name.contains(OFFSET_NODE) {
            offset = true;
        }
    }
    Ok(heatmap && offset)
}

/// 剪掉后处理尾部，返回新的模型字节。
pub fn trim(bytes: &[u8]) -> Result<Vec<u8>> {
    let graph_payload = find_graph(bytes)?.context("ONNX 里找不到 graph")?;
    let graph_fields = split(graph_payload)?;

    let mut nodes: Vec<Node<'_>> = Vec::new();
    for field in &graph_fields {
        if field.number == 1 {
            nodes.push(parse_node(field.encoded, field.payload)?);
        }
    }

    let heatmap = nodes
        .iter()
        .find(|node| node.name.contains(HEATMAP_NODE) && node.op_type != "Identity")
        .and_then(|node| node.outputs.first())
        .context("在 MoveNet 图里找不到 heatmap 卷积输出")?
        .clone();

    // 找到 NHWC→NCHW 的轴变换节点，它前面的归一化前缀（Cast/Sub/Mul/Slice…）
    // 里有个 tf2onnx 生成的 `unstack`→`Slice` 结构，tract 会给它推错形状，
    // 于是 run 阶段报 "Clashing resolution"。把图输入直接改到轴变换节点的
    // 输入上，整段前缀就不在图里了——归一化改由 Rust 预处理完成。
    // 第一个卷积 -> 它消费的转置张量 -> 产生该张量的节点 -> 该节点的输入
    // 就是「归一化之后、轴变换之前」的 NHWC 张量。
    let normalized_input = nodes
        .iter()
        .find(|node| node.name.contains(FIRST_CONV_NODE) && node.op_type == "Conv")
        .and_then(|node| node.inputs.first())
        .and_then(|transposed| {
            nodes
                .iter()
                .find(|node| node.outputs.iter().any(|output| output == transposed))
        })
        .and_then(|transpose| transpose.inputs.first())
        .cloned();
    if normalized_input.is_none() {
        bail!("找不到主干入口的轴变换节点，无法把归一化搬到 Rust 侧");
    }
    let offset = nodes
        .iter()
        .find(|node| node.name.contains(OFFSET_NODE) && node.op_type != "Identity")
        .and_then(|node| node.outputs.first())
        .context("在 MoveNet 图里找不到 offset 卷积输出")?
        .clone();

    // 从目标输出反向求闭包，决定保留哪些节点
    let mut needed = vec![false; nodes.len()];
    let mut frontier = vec![heatmap.clone(), offset.clone()];
    while let Some(tensor) = frontier.pop() {
        for (index, node) in nodes.iter().enumerate() {
            if needed[index] || !node.outputs.iter().any(|output| output == &tensor) {
                continue;
            }
            // 归一化张量现在是图输入，产生它的前缀节点整段丢掉
            if node
                .outputs
                .iter()
                .any(|output| Some(output) == normalized_input.as_ref())
            {
                continue;
            }
            needed[index] = true;
            frontier.extend(node.inputs.iter().cloned());
        }
    }

    if needed.iter().all(|flag| !*flag) {
        bail!("剪尾后没有剩下任何节点，模型结构可能已变");
    }

    // 重建 graph：保留非 node / 非 output 的字段，替换 node 与 output 列表
    let mut new_graph = Vec::new();
    let mut wrote_nodes = false;
    for field in &graph_fields {
        match field.number {
            1 => {
                if !wrote_nodes {
                    for (index, node) in nodes.iter().enumerate() {
                        if needed[index] {
                            new_graph.extend_from_slice(node.encoded);
                        }
                    }
                    wrote_nodes = true;
                }
            }
            // 输入改写成"归一化之后、轴变换之前"的张量
            11 => {
                if let Some(name) = &normalized_input {
                    let (height, width) = input_spatial(&graph_fields).unwrap_or((192, 192));
                    let info = input_value_info(name, &[1, height, width, 3]);
                    new_graph
                        .extend_from_slice(&encode_field(11, &info));
                } else {
                    new_graph.extend_from_slice(field.encoded);
                }
            }
            // 旧输出丢掉，换成新的两个输出；value_info 原样保留
            12 => {}
            _ => new_graph.extend_from_slice(field.encoded),
        }
    }
    // 复用图里已有的 value_info（如果导出器留了的话），否则按 MoveNet 的
    // 1/4 分辨率推算 heatmap / offset 的具体形状。
    // 一定要给出具体形状：连 rank 都不声明时，tract 的符号解析会在 run 阶段
    // 报 "Clashing resolution"。
    let existing: Vec<(String, &[u8])> = graph_fields
        .iter()
        .filter(|field| field.number == 13)
        .filter_map(|field| value_info_name(field.payload).map(|name| (name, field.encoded)))
        .collect();
    let (height, width) = input_spatial(&graph_fields).unwrap_or((192, 192));
    let (grid_h, grid_w) = ((height / 4).max(1), (width / 4).max(1));
    let output_info = |name: &str, channels: u64| -> Vec<u8> {
        existing
            .iter()
            .find(|(existing_name, _)| existing_name == name)
            .map(|(_, encoded)| encoded.to_vec())
            .unwrap_or_else(|| value_info(name, &[1, channels, grid_h, grid_w]))
    };
    write_bytes_field(12, &output_info(&heatmap, 17), &mut new_graph);
    write_bytes_field(12, &output_info(&offset, 34), &mut new_graph);

    // 重建顶层：替换 graph 字段
    let mut output = Vec::new();
    for field in split(bytes)? {
        if field.number == 7 {
            write_bytes_field(7, &new_graph, &mut output);
        } else {
            output.extend_from_slice(field.encoded);
        }
    }
    Ok(output)
}
