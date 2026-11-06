// JPEG の EXIF から「撮影日時」と「撮影場所（GPS）」を読み取る（外部ライブラリなし）。
// 戻り値: { time?: number(ms), loc?: { lat, lng } } または null
export async function readExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // JPEG 以外
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) break;
      const len = v.getUint16(off + 2);
      // APP1 "Exif\0\0"
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if (marker === 0xffda) break; // 画像本体に到達
      off += 2 + len;
    }
  } catch { /* 読めない画像は無視 */ }
  return null;
}

function parseTiff(v, start) {
  const le = v.getUint16(start) === 0x4949; // "II" = リトルエンディアン
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);

  const readIFD = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      tags[u16(e)] = { count: u32(e + 4), at: e + 8 };
    }
    return tags;
  };
  const ascii = (t) => {
    const o = t.count > 4 ? u32(t.at) : t.at;
    let s = '';
    for (let i = 0; i < t.count; i++) {
      const c = v.getUint8(start + o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const rationals = (t) => {
    const o = u32(t.at);
    return Array.from({ length: t.count }, (_, i) => u32(o + i * 8) / u32(o + i * 8 + 4));
  };

  const res = {};
  const ifd0 = readIFD(u32(4));

  // 撮影日時（DateTimeOriginal + タイムゾーン）
  if (ifd0[0x8769]) {
    const ex = readIFD(u32(ifd0[0x8769].at));
    const dt = ex[0x9003] && ascii(ex[0x9003]);
    const tz = ex[0x9011] && ascii(ex[0x9011]);
    const m = dt?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${/^[+-]\d{2}:\d{2}$/.test(tz || '') ? tz : ''}`;
      const t = new Date(iso).getTime();
      if (!Number.isNaN(t)) res.time = t;
    }
  }

  // 撮影場所（GPS）
  if (ifd0[0x8825]) {
    const g = readIFD(u32(ifd0[0x8825].at));
    if (g[2] && g[4]) {
      const deg = ([d, m, s]) => d + m / 60 + s / 3600;
      let lat = deg(rationals(g[2]));
      let lng = deg(rationals(g[4]));
      if (g[1] && ascii(g[1]) === 'S') lat = -lat;
      if (g[3] && ascii(g[3]) === 'W') lng = -lng;
      if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
        res.loc = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
      }
    }
  }
  return res.time || res.loc ? res : null;
}
