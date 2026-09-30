/**
 * 极简 PNG 编码器（RGBA8，无滤波）。
 *
 * CLI 在 Node 里把图集拼出来，这里不引入任何原生图形依赖：
 * PNG 本身就是 zlib + 分块 CRC，几十行足够。
 */

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** 把 RGBA 像素编码成 PNG。`rgba` 长度必须是 `width * height * 4`。 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`像素数据长度不匹配：期望 ${expected}，实际 ${rgba.length}`);
  }

  // 每个扫描行前面加一个 0（无滤波）字节
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + row * stride, stride).copy(
      raw,
      row * (stride + 1) + 1,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 6 })),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}
