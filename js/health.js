import { dayKey, isDayKey } from './util.js';

// 表示する項目。key はショートカットで作る辞書のキー名。
export const HEALTH_FIELDS = [
  { key: 'steps', icon: '👟', label: '歩数', unit: '歩', digits: 0, aliases: ['歩数', 'step', 'stepCount'] },
  { key: 'distance', icon: '🗺️', label: '距離', unit: 'km', digits: 1, aliases: ['距離', 'walkingDistance', 'distanceKm'] },
  { key: 'activeEnergy', icon: '🔥', label: 'アクティブ', unit: 'kcal', digits: 0, aliases: ['アクティブエネルギー', 'activeCalories', 'kcal'] },
  { key: 'exercise', icon: '💪', label: 'エクササイズ', unit: '分', digits: 0, aliases: ['エクササイズ', 'exerciseMinutes'] },
  { key: 'flights', icon: '🪜', label: '上った階数', unit: '階', digits: 0, aliases: ['上った階数', 'flightsClimbed'] },
  { key: 'sleep', icon: '😴', label: '睡眠', unit: '時間', digits: 1, aliases: ['睡眠', 'sleepHours'] },
  { key: 'restingHR', icon: '💓', label: '安静時心拍', unit: 'bpm', digits: 0, aliases: ['安静時心拍数', 'restingHeartRate'] },
  { key: 'heartRate', icon: '❤️', label: '平均心拍', unit: 'bpm', digits: 0, aliases: ['心拍数', 'avgHeartRate'] },
  { key: 'weight', icon: '⚖️', label: '体重', unit: 'kg', digits: 1, aliases: ['体重', 'bodyMass'] },
  { key: 'mindful', icon: '🧘', label: 'マインドフル', unit: '分', digits: 0, aliases: ['マインドフルネス', 'mindfulMinutes'] },
];

const ALIAS = new Map();
for (const f of HEALTH_FIELDS) {
  ALIAS.set(f.key.toLowerCase(), f.key);
  for (const a of f.aliases) ALIAS.set(a.toLowerCase(), f.key);
}

// "8,123 歩" や "7.5" などを数値化
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
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
  const rec = { date: normalizeDate(obj.date ?? obj['日付']) };
  for (const [k, v] of Object.entries(obj)) {
    const key = ALIAS.get(k.toLowerCase());
    if (!key) continue;
    const n = toNumber(v);
    if (n !== null) rec[key] = n;
  }
  // 睡眠を秒・分で渡された場合は時間に変換
  if (rec.sleep > 1440) rec.sleep = rec.sleep / 3600;
  else if (rec.sleep > 24) rec.sleep = rec.sleep / 60;
  // 距離を m で渡された場合
  if (rec.distance > 200) rec.distance = rec.distance / 1000;
  return rec;
}

// ショートカットから来た JSON テキストをパース。単日オブジェクト / 配列 / {days:[...]} に対応
export function parseHealthText(text) {
  let data;
  try {
    data = JSON.parse(String(text).trim());
  } catch {
    throw new Error('JSON として読み取れませんでした');
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.days) ? data.days : [data];
  const records = list.filter((x) => x && typeof x === 'object').map(normalizeRecord)
    .filter((r) => Object.keys(r).length > 1);
  if (!records.length) throw new Error('ヘルスケアの項目が見つかりませんでした');
  return records;
}

export function formatValue(field, v) {
  if (v == null) return '–';
  return Number(v).toLocaleString('ja-JP', { maximumFractionDigits: field.digits, minimumFractionDigits: field.digits });
}
