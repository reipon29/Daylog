// 天気の取得（Open-Meteo：無料・APIキー不要）
// 送るのは「約1km単位に丸めた座標」と日時だけ。
//   直近 → 現在の天気 / 3か月以内 → 予報APIの過去データ / それより前 → 過去データAPI

const CODES = {
  0: ['☀️', '快晴'], 1: ['🌤️', '晴れ'], 2: ['⛅', '晴れ時々くもり'], 3: ['☁️', 'くもり'],
  45: ['🌫️', '霧'], 48: ['🌫️', '霧'],
  51: ['🌦️', '霧雨'], 53: ['🌦️', '霧雨'], 55: ['🌦️', '霧雨'], 56: ['🌦️', '霧雨'], 57: ['🌦️', '霧雨'],
  61: ['🌧️', '小雨'], 63: ['🌧️', '雨'], 65: ['🌧️', '大雨'], 66: ['🌧️', '冷たい雨'], 67: ['🌧️', '冷たい雨'],
  71: ['🌨️', '小雪'], 73: ['❄️', '雪'], 75: ['❄️', '大雪'], 77: ['❄️', '雪'],
  80: ['🌦️', 'にわか雨'], 81: ['🌧️', 'にわか雨'], 82: ['⛈️', '激しいにわか雨'],
  85: ['🌨️', 'にわか雪'], 86: ['🌨️', 'にわか雪'],
  95: ['⛈️', '雷雨'], 96: ['⛈️', '雷雨'], 99: ['⛈️', '雷雨'],
};

export function weatherInfo(code) {
  const [emoji, label] = CODES[code] || ['🌡️', ''];
  return { emoji, label };
}

const ymdUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function fetchWeather(lat, lng, time) {
  const la = lat.toFixed(2);
  const lo = lng.toFixed(2);
  const age = Date.now() - time;
  let url;
  if (age > -3600e3 && age < 2 * 3600e3) {
    url = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,weather_code&timezone=GMT`;
  } else {
    const host = age < 80 * 86400e3 ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
    const start = ymdUTC(time - 86400e3);
    const end = ymdUTC(time + 86400e3);
    url = `${host}?latitude=${la}&longitude=${lo}&hourly=temperature_2m,weather_code&start_date=${start}&end_date=${end}&timezone=GMT&timeformat=unixtime`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    if (j.current) {
      const { weather_code: code, temperature_2m: temp } = j.current;
      return code == null || temp == null ? null : { code, temp: Math.round(temp) };
    }
    const t = j.hourly?.time || [];
    let best = -1;
    for (let i = 0; i < t.length; i++) {
      if (j.hourly.weather_code[i] == null || j.hourly.temperature_2m[i] == null) continue;
      if (best < 0 || Math.abs(t[i] * 1000 - time) < Math.abs(t[best] * 1000 - time)) best = i;
    }
    if (best < 0) return null;
    return { code: j.hourly.weather_code[best], temp: Math.round(j.hourly.temperature_2m[best]) };
  } catch {
    return null;
  }
}
