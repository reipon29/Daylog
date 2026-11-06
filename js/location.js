// 位置情報の取得と逆ジオコーディング（地名化）
export function getPosition({ timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('この端末は位置情報に対応していません'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: +p.coords.latitude.toFixed(6),
        lng: +p.coords.longitude.toFixed(6),
        acc: Math.round(p.coords.accuracy),
      }),
      (err) => reject(new Error(err.code === 1 ? '位置情報の利用が許可されていません' : '現在地を取得できませんでした')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

const CACHE_KEY = 'daylog.geocache';
function cacheGet(k) {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[k]; } catch { return undefined; }
}
function cacheSet(k, v) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    c[k] = v;
    const keys = Object.keys(c);
    if (keys.length > 500) delete c[keys[0]];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* storage unavailable */ }
}

// OpenStreetMap Nominatim（無料・個人利用の範囲で）
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ja&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const j = await res.json();
    const name = placeName(j);
    if (name) cacheSet(key, name);
    return name;
  } catch {
    return null;
  }
}

function placeName(j) {
  const a = j.address || {};
  const city = a.city || a.town || a.village || a.county || '';
  const ward = a.city_district || a.suburb || a.quarter || a.neighbourhood || '';
  const poi = j.name || a.amenity || a.shop || a.tourism || a.leisure || a.building || a.railway || '';
  const area = [city, ward].filter(Boolean).join(' ');
  if (poi && area) return `${poi}（${area}）`;
  return poi || area || j.display_name?.split(',').slice(0, 2).join(' ') || null;
}
