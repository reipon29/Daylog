import { dayKey, isDayKey } from './util.js';

// 表示する項目。
// sum: 同じ日に複数の値が来たら合計する項目（歩数など）/ avg: 平均する項目 / それ以外は最後の値
export const HEALTH_FIELDS = [
  { key: 'steps', icon: '👟', label: '歩数', unit: '歩', digits: 0, mode: 'sum', aliases: ['歩数', '歩', 'step', 'steps', 'stepCount'] },
  { key: 'distance', icon: '🗺️', label: '距離', unit: 'km', digits: 1, mode: 'sum', aliases: ['距離', '歩行距離', '歩行+走行の距離', '歩行＋走行の距離', 'walkingDistance', 'distanceKm'] },
  { key: 'activeEnergy', icon: '🔥', label: 'アクティブ', unit: 'kcal', digits: 0, mode: 'sum', aliases: ['アクティブエネルギー', 'アクティブ', '消費カロリー', 'カロリー', '活動エネルギー', 'activeCalories', 'kcal'] },
  { key: 'exercise', icon: '💪', label: 'エクササイズ', unit: '分', digits: 0, mode: 'sum', aliases: ['エクササイズ', 'エクササイズ時間', '運動', 'exerciseMinutes'] },
  { key: 'flights', icon: '🪜', label: '上った階数', unit: '階', digits: 0, mode: 'sum', aliases: ['上った階数', '階数', 'flightsClimbed'] },
  { key: 'sleep', icon: '😴', label: '睡眠', unit: '時間', digits: 1, mode: 'sum', aliases: ['睡眠', '睡眠時間', 'sleepHours'] },
  { key: 'restingHR', icon: '💓', label: '安静時心拍', unit: 'bpm', digits: 0, aliases: ['安静時心拍数', '安静時心拍', 'restingHeartRate'] },
  { key: 'heartRate', icon: '❤️', label: '平均心拍', unit: 'bpm', digits: 0, mode: 'avg', aliases: ['心拍数', '平均心拍', '心拍', 'avgHeartRate'] },
  { key: 'weight', icon: '⚖️', label: '体重', unit: 'kg', digits: 1, aliases: ['体重', 'bodyMass'] },
  { key: 'mindful', icon: '🧘', label: 'マインドフル', unit: '分', digits: 0, mode: 'sum', aliases: ['マインドフルネス', 'マインドフル', 'mindfulMinutes'] },
];
const FIELD = Object.fromEntries(HEALTH_FIELDS.map((f) => [f.key, f]));

// キー名のゆれを吸収（大文字小文字・空白・括弧内の単位を無視）
const norm = (k) => String(k).toLowerCase().replace(/[（(][^）)]*[）)]/g, '').replace(/[\s　]/g, '');
const ALIAS = new Map();
for (const f of HEALTH_FIELDS) {
  ALIAS.set(norm(f.key), f.key);
  for (const a of f.aliases) ALIAS.set(norm(a), f.key);
}
const DATE_KEYS = new Set(['date', '日付', '日にち'].map(norm));

// "8,123 歩" や "7.5" などから数値をすべて取り出す
function numbersIn(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(numbersIn);
  if (typeof v !== 'string') return [];
  return (v.replace(/(\d),(\d{3})/g, '$1$2').match(/-?\d+(\.\d+)?/g) || []).map(Number);
}

function normalizeDate(v) {
  if (!v) return dayKey();
  const s = String(v).trim();
  if (isDayKey(s)) return s;
  const m = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? dayKey() : dayKey(d);
}

function normalizeRecord(obj) {
  const dateEntry = Object.entries(obj).find(([k]) => DATE_KEYS.has(norm(k)));
  const rec = { date: normalizeDate(dateEntry?.[1]) };
  for (const [k, v] of Object.entries(obj)) {
    const key = ALIAS.get(norm(k));
    if (!key) continue;
    const nums = numbersIn(v);
    if (!nums.length) continue;
    const mode = FIELD[key].mode;
    rec[key] = mode === 'sum' ? nums.reduce((a, b) => a + b, 0)
      : mode === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length
        : nums[nums.length - 1];
  }
  // 睡眠を秒・分で渡された場合は時間に変換
  if (rec.sleep > 1440) rec.sleep = rec.sleep / 3600;
  else if (rec.sleep > 24) rec.sleep = rec.sleep / 60;
  // 距離を m で渡された場合
  if (rec.distance > 200) rec.distance = rec.distance / 1000;
  return rec;
}

// 「歩数: 8123」のような行のテキストを読む。
// キーのない数字だけの行は、直前の項目の続きとして扱う（ショートカットで複数の値が改行で並ぶ場合）
function parseLines(text) {
  const obj = {};
  let last = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:：=＝\d][^:：=＝]*?)\s*[:：=＝]\s*(.*)$/) || line.match(/^([^\s\d][^\s]*)\s+(-?[\d,.]+.*)$/);
    if (m) {
      last = m[1].trim();
      obj[last] = [m[2]];
    } else if (last && /^-?[\d,.]+/.test(line)) {
      obj[last].push(line);
    }
  }
  return obj;
}

// ショートカットから来たテキストを読む。
// 対応形式：JSON（単日 / 配列 / {days:[...]}）、または「項目名: 値」の行
export function parseHealthText(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('内容が空です。ショートカットを実行してから試してください');
  let list;
  try {
    const data = JSON.parse(t);
    list = Array.isArray(data) ? data : Array.isArray(data?.days) ? data.days : [data];
  } catch {
    list = [parseLines(t)];
  }
  const records = list.filter((x) => x && typeof x === 'object').map(normalizeRecord)
    .filter((r) => Object.keys(r).length > 1);
  if (!records.length) {
    const head = t.length > 40 ? `${t.slice(0, 40)}…` : t;
    throw new Error(`「歩数」などの項目が見つかりませんでした（受け取った内容：${head}）`);
  }
  return records;
}

export function formatValue(field, v) {
  if (v == null) return '–';
  return Number(v).toLocaleString('ja-JP', { maximumFractionDigits: field.digits, minimumFractionDigits: field.digits });
}
