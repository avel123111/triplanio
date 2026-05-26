// Open-Meteo weather forecast for given coords and date range
// Returns daily forecast array or null
export async function getWeather(lat, lon, startDate, endDate) {
  if (lat == null || lon == null || !startDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxFuture = new Date(today);
  maxFuture.setDate(maxFuture.getDate() + 16);

  const start = new Date(startDate);
  const end = new Date(endDate || startDate);
  if (end < today) return { historical: true };
  const s = start < today ? today : start;
  const e = end > maxFuture ? maxFuture : end;
  if (e < s) return null;

  const fmt = d => d.toISOString().slice(0, 10);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&start_date=${fmt(s)}&end_date=${fmt(e)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return { daily: data.daily, historical: false };
  } catch {
    return null;
  }
}

// WMO weather code → label + emoji
export function weatherInfo(code) {
  const map = {
    0: { label: 'Clear', icon: '☀️' },
    1: { label: 'Mostly clear', icon: '🌤️' },
    2: { label: 'Partly cloudy', icon: '⛅' },
    3: { label: 'Overcast', icon: '☁️' },
    45: { label: 'Fog', icon: '🌫️' },
    48: { label: 'Rime fog', icon: '🌫️' },
    51: { label: 'Light drizzle', icon: '🌦️' },
    53: { label: 'Drizzle', icon: '🌦️' },
    55: { label: 'Heavy drizzle', icon: '🌧️' },
    61: { label: 'Light rain', icon: '🌦️' },
    63: { label: 'Rain', icon: '🌧️' },
    65: { label: 'Heavy rain', icon: '🌧️' },
    71: { label: 'Light snow', icon: '🌨️' },
    73: { label: 'Snow', icon: '❄️' },
    75: { label: 'Heavy snow', icon: '❄️' },
    80: { label: 'Showers', icon: '🌦️' },
    81: { label: 'Showers', icon: '🌧️' },
    82: { label: 'Heavy showers', icon: '⛈️' },
    95: { label: 'Thunderstorm', icon: '⛈️' },
    96: { label: 'Thunderstorm + hail', icon: '⛈️' },
    99: { label: 'Severe thunderstorm', icon: '⛈️' },
  };
  return map[code] || { label: 'Unknown', icon: '❓' };
}