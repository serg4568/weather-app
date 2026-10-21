import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, MapPin, RefreshCw, AlertCircle, Settings, X, ChevronRight,
  ChevronLeft, Sun, Wind, Droplets, Eye, Gauge, Compass, Thermometer,
  Navigation, Star, Radio, BellRing, Check
} from 'lucide-react';

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И КОМПОНЕНТЫ
// ==========================================

// Стрелка направления ветра (+180°: откуда дует)
const WindArrow = ({ deg = 0, size = 12, className = "" }) => (
  <Navigation
    size={size}
    className={`inline-block transform ${className}`}
    style={{ transform: `rotate(${(deg - 225 + 360) % 360}deg)` }}
  />
);

// Универсальный рендер PNG-иконки
const WeatherIcon = ({ iconCode, isDay = true, provider = "twc", size = 24, className = "" }) => {
  const folder = provider === "accuweather" ? "accuicons" : "weather-icons";
  const code = iconCode !== undefined && iconCode !== null ? iconCode : (isDay ? 1 : 33);
  const iconPath = `/${folder}/${code}.png`;

  return (
    <img
      src={iconPath}
      alt={`Иконка ${code}`}
      width={size}
      height={size}
      className={`object-contain inline-block shrink-0 ${className}`}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.opacity = '0.3';
      }}
    />
  );
};

// Функция адаптивного цвета температуры в диапазоне от -60°C до +60°C
const getTempColor = (temp) => {
  const clamped = Math.max(-60, Math.min(60, temp));
  const stops = [
    { t: -60, r: 147, g: 51,  b: 234 }, // Фиолетовый (-60)
    { t: -30, r: 59,  g: 130, b: 246 }, // Глубокий синий (-30)
    { t: -10, r: 6,   g: 182, b: 212 }, // Голубой/бирюзовый (-10)
    { t: 0,   r: 16,  g: 185, b: 129 }, // Зеленовато-бирюзовый (0)
    { t: 15,  r: 132, g: 204, b: 22  }, // Салатово-зеленый (+15)
    { t: 25,  r: 234, g: 179, b: 8   }, // Желто-золотой (+25)
    { t: 38,  r: 249, g: 115, b: 22  }, // Оранжевый (+38)
    { t: 60,  r: 220, g: 38,  b: 38  }  // Сильно красный (+60)
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (clamped >= s1.t && clamped <= s2.t) {
      const factor = (clamped - s1.t) / (s2.t - s1.t);
      const r = Math.round(s1.r + factor * (s2.r - s1.r));
      const g = Math.round(s1.g + factor * (s2.g - s1.g));
      const b = Math.round(s1.b + factor * (s2.b - s1.b));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return clamped > 0 ? "rgb(220, 38, 38)" : "rgb(147, 51, 234)";
};

// Стиль заливки карточки при осадках
const getPrecipitationStyle = (rain = 0, snow = 0, ice = 0, total = 0) => {
  const r = Number(rain) || 0;
  const s = Number(snow) || 0;
  const i = Number(ice) || 0;
  const t = Number(total) || 0;

  if (s > 0) {
    return "bg-sky-500/20 border-sky-400/40 shadow-sm shadow-sky-500/10";
  }
  if (r > 0 || i > 0 || t > 0) {
    return "bg-blue-600/25 border-blue-400/40 shadow-sm shadow-blue-500/10";
  }
  return "bg-white/5 border-white/10";
};

// Форматирование осадков: rain (мм), snow (см), ice (мм), total (мм)
const formatPrecipDetails = (rain = 0, snow = 0, ice = 0, total = 0) => {
  const parts = [];
  const r = Number(rain) || 0;
  const s = Number(snow) || 0;
  const i = Number(ice) || 0;
  const t = Number(total) || 0;

  if (s > 0) parts.push(`${s.toFixed(1)} см снег`);
  if (r > 0) parts.push(`${r.toFixed(1)} мм`);
  if (i > 0) parts.push(`${i.toFixed(1)} мм лед`);

  if (parts.length === 0 && t > 0) {
    parts.push(`${t.toFixed(1)} мм`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
};

// Время назад
const getTimeAgoString = (timestampSeconds) => {
  if (!timestampSeconds) return "недавно";
  const nowSeconds = Math.floor(Date.now() / 1000);
  const diffMinutes = Math.max(0, Math.floor((nowSeconds - timestampSeconds) / 60));
  if (diffMinutes === 0) return "только что";
  if (diffMinutes === 1) return "1 мин назад";
  if (diffMinutes >= 2 && diffMinutes <= 4) return `${diffMinutes} мин назад`;
  if (diffMinutes < 60) return `${diffMinutes} мин назад`;
  return `${Math.floor(diffMinutes / 60)} ч. назад`;
};

// ==========================================
// АДАПТЕРЫ ДАННЫХ
// ==========================================

// Адаптер: The Weather Company (TWC aggcommon)
const adaptTwcData = (raw) => {
  const currentRaw = raw["v3-wx-observations-current"] || {};
  const hourlyRaw = raw["v3-wx-forecast-hourly-1day"] || {};
  const dailyRaw = raw["v3-wx-forecast-daily-15day"] || {};
  const obsData = raw["v2obs"]?.observation || null;
  const insights = raw["v3-insights"] || [];

  let alertText = null;
  if (Array.isArray(insights) && insights.length > 0) {
    const sorted = [...insights]
      .filter(item => typeof item.insightPriority === 'number' && Array.isArray(item.insightTextLong) && item.insightTextLong.length > 0)
      .sort((a, b) => a.insightPriority - b.insightPriority);
    if (sorted.length > 0) alertText = sorted[0].insightTextLong[0];
  }

  const current = {
    temperature: currentRaw.temperature ?? 0,
    temperatureFeelsLike: currentRaw.temperatureFeelsLike ?? currentRaw.temperature ?? 0,
    feelsLikePhrase: null,
    wxPhraseLong: currentRaw.wxPhraseLong || "Ясно",
    iconCode: currentRaw.iconCode,
    isDay: currentRaw.dayOrNight !== 'N',
    windSpeed: currentRaw.windSpeed ?? 0,
    windDirection: currentRaw.windDirection ?? 0,
    windDirectionCardinal: currentRaw.windDirectionCardinal || "—",
    relativeHumidity: currentRaw.relativeHumidity ?? 0,
    pressureMm: Math.round((currentRaw.pressureAltimeter || 1013) * 0.750062),
    pressureHpa: Math.round(currentRaw.pressureAltimeter || 1013),
    uvIndex: currentRaw.uvIndex ?? 0,
    uvDescription: currentRaw.uvDescription || "Низкий",
    visibility: Math.round(currentRaw.visibility ?? 10)
  };

  let stationInfo = null;
  if (obsData && obsData.obs_name) {
    stationInfo = {
      name: obsData.obs_name,
      temp: obsData.temp !== null && obsData.temp !== undefined ? `${Math.round(obsData.temp)}°` : null,
      phrase: obsData.wx_phrase || null,
      updated: getTimeAgoString(obsData.valid_time_gmt)
    };
  }

  const hourly = [];
  const hTimes = hourlyRaw.validTimeLocal || [];
  for (let i = 0; i < Math.min(hTimes.length, 24); i++) {
    const rain = hourlyRaw.qpfRain?.[i] ?? 0;
    const snow = hourlyRaw.qpfSnow?.[i] ?? 0;
    const ice = hourlyRaw.qpfIce?.[i] ?? 0;
    const total = hourlyRaw.qpf?.[i] ?? 0;

    hourly.push({
      timeStr: hTimes[i],
      temperature: Math.round(hourlyRaw.temperature?.[i] ?? 0),
      isDay: hourlyRaw.dayOrNight?.[i] === 'D',
      iconCode: hourlyRaw.iconCode?.[i],
      phrase: hourlyRaw.wxPhraseLong?.[i] || "",
      precipChance: hourlyRaw.precipChance?.[i] ?? 0,
      rain, snow, ice, total,
      precipText: formatPrecipDetails(rain, snow, ice, total),
      windSpeed: Math.round(hourlyRaw.windSpeed?.[i] ?? 0),
      windDirection: hourlyRaw.windDirection?.[i] ?? 0,
      windDirectionCardinal: hourlyRaw.windDirectionCardinal?.[i] || ""
    });
  }

  const daily = [];
  const dTimes = dailyRaw.validTimeLocal || [];
  const dp = dailyRaw.daypart?.[0] || {};
  for (let i = 0; i < Math.min(dTimes.length, 15); i++) {
    const dIdx = i * 2;
    const nIdx = i * 2 + 1;

    const dRain = dp.qpfRain?.[dIdx] ?? 0;
    const dSnow = dp.qpfSnow?.[dIdx] ?? 0;
    const dIce = dp.qpfIce?.[dIdx] ?? 0;
    const dTotal = dp.qpf?.[dIdx] ?? 0;

    const nRain = dp.qpfRain?.[nIdx] ?? 0;
    const nSnow = dp.qpfSnow?.[nIdx] ?? 0;
    const nIce = dp.qpfIce?.[nIdx] ?? 0;
    const nTotal = dp.qpf?.[nIdx] ?? 0;

    daily.push({
      timeStr: dTimes[i],
      dayName: dailyRaw.dayOfWeek?.[i] || "",
      maxTemp: Math.round(dailyRaw.calendarDayTemperatureMax?.[i] ?? 0),
      minTemp: Math.round(dailyRaw.calendarDayTemperatureMin?.[i] ?? 0),
      day: {
        iconCode: dp.iconCode?.[dIdx] ?? 44,
        temp: dp.temperature?.[dIdx] !== null && dp.temperature?.[dIdx] !== undefined ? Math.round(dp.temperature[dIdx]) : Math.round(dailyRaw.calendarDayTemperatureMax?.[i] ?? 0),
        phrase: dp.wxPhraseLong?.[dIdx] || "--",
        pop: dp.precipChance?.[dIdx] ?? 0,
        rain: dRain, snow: dSnow, ice: dIce, total: dTotal,
        precipText: formatPrecipDetails(dRain, dSnow, dIce, dTotal),
        windSpeed: dp.windSpeed?.[dIdx] ? Math.round(dp.windSpeed[dIdx]) : null,
        windDir: dp.windDirection?.[dIdx] ?? 0,
        windCard: dp.windDirectionCardinal?.[dIdx] || ""
      },
      night: {
        iconCode: dp.iconCode?.[nIdx] ?? 44,
        temp: dp.temperature?.[nIdx] !== null && dp.temperature?.[nIdx] !== undefined ? Math.round(dp.temperature[nIdx]) : Math.round(dailyRaw.calendarDayTemperatureMin?.[i] ?? 0),
        phrase: dp.wxPhraseLong?.[nIdx] || "--",
        pop: dp.precipChance?.[nIdx] ?? 0,
        rain: nRain, snow: nSnow, ice: nIce, total: nTotal,
        precipText: formatPrecipDetails(nRain, nSnow, nIce, nTotal),
        windSpeed: dp.windSpeed?.[nIdx] ? Math.round(dp.windSpeed[nIdx]) : null,
        windDir: dp.windDirection?.[nIdx] ?? 0,
        windCard: dp.windDirectionCardinal?.[nIdx] || ""
      }
    });
  }

  return { alertText, current, stationInfo, hourly, daily };
};

// Адаптер: AccuWeather
const adaptAccuWeatherData = (currentConditionsRaw, hourlyRaw, dailyRaw) => {
  const alertText = dailyRaw?.Headline?.Text || null;

  const cur = Array.isArray(currentConditionsRaw) && currentConditionsRaw.length > 0 
    ? currentConditionsRaw[0] 
    : (Array.isArray(hourlyRaw) && hourlyRaw.length > 0 ? hourlyRaw[0] : {});

  const feelsLikePhrase = cur.RealFeelTemperature?.Metric?.Phrase || cur.RealFeelTemperature?.Phrase || null;

  const current = {
    temperature: Math.round(cur.Temperature?.Metric?.Value ?? cur.Temperature?.Value ?? 0),
    temperatureFeelsLike: Math.round(cur.RealFeelTemperature?.Metric?.Value ?? cur.RealFeelTemperature?.Value ?? cur.Temperature?.Metric?.Value ?? 0),
    feelsLikePhrase,
    wxPhraseLong: cur.WeatherText || cur.IconPhrase || "Ясно",
    iconCode: cur.WeatherIcon,
    isDay: cur.IsDayTime !== undefined ? cur.IsDayTime : (cur.IsDaylight ?? true),
    windSpeed: Math.round(cur.Wind?.Speed?.Metric?.Value ?? cur.Wind?.Speed?.Value ?? 0),
    windDirection: cur.Wind?.Direction?.Degrees ?? 0,
    windDirectionCardinal: cur.Wind?.Direction?.Localized || "—",
    relativeHumidity: cur.RelativeHumidity ?? 0,
    pressureMm: cur.Pressure?.Metric?.Value ? Math.round(cur.Pressure.Metric.Value * 0.750062) : 760,
    pressureHpa: cur.Pressure?.Metric?.Value ? Math.round(cur.Pressure.Metric.Value) : 1013,
    uvIndex: cur.UVIndex ?? 0,
    uvDescription: cur.UVIndexText || "Низкий",
    visibility: Math.round(cur.Visibility?.Metric?.Value ?? cur.Visibility?.Value ?? 10)
  };

  const stationInfo = null;

  const hourly = (Array.isArray(hourlyRaw) ? hourlyRaw.slice(0, 24) : []).map(h => {
    const rain = h.Rain?.Value ?? 0;
    const snow = h.Snow?.Value ?? 0;
    const ice = h.Ice?.Value ?? 0;
    const total = h.TotalLiquid?.Value ?? 0;

    return {
      timeStr: h.DateTime,
      temperature: Math.round(h.Temperature?.Value ?? 0),
      isDay: h.IsDaylight,
      iconCode: h.WeatherIcon,
      phrase: h.IconPhrase || "",
      precipChance: h.PrecipitationProbability ?? 0,
      rain, snow, ice, total,
      precipText: formatPrecipDetails(rain, snow, ice, total),
      windSpeed: Math.round(h.Wind?.Speed?.Value ?? 0),
      windDirection: h.Wind?.Direction?.Degrees ?? 0,
      windDirectionCardinal: h.Wind?.Direction?.Localized || ""
    };
  });

  const daily = (dailyRaw?.DailyForecasts || []).slice(0, 15).map(df => {
    const d = df.Day || {};
    const n = df.Night || {};

    const dRain = d.Rain?.Value ?? 0;
    const dSnow = d.Snow?.Value ?? 0;
    const dIce = d.Ice?.Value ?? 0;
    const dTotal = d.TotalLiquid?.Value ?? 0;

    const nRain = n.Rain?.Value ?? 0;
    const nSnow = n.Snow?.Value ?? 0;
    const nIce = n.Ice?.Value ?? 0;
    const nTotal = n.TotalLiquid?.Value ?? 0;

    return {
      timeStr: df.Date,
      dayName: new Date(df.Date).toLocaleDateString('ru-RU', { weekday: 'short' }),
      maxTemp: Math.round(df.Temperature?.Maximum?.Value ?? 0),
      minTemp: Math.round(df.Temperature?.Minimum?.Value ?? 0),
      day: {
        iconCode: d.Icon,
        temp: Math.round(df.Temperature?.Maximum?.Value ?? 0),
        phrase: d.LongPhrase || d.ShortPhrase || d.IconPhrase || "Ясно",
        pop: d.PrecipitationProbability ?? 0,
        rain: dRain, snow: dSnow, ice: dIce, total: dTotal,
        precipText: formatPrecipDetails(dRain, dSnow, dIce, dTotal),
        windSpeed: d.Wind?.Speed?.Value ? Math.round(d.Wind.Speed.Value) : null,
        windDir: d.Wind?.Direction?.Degrees ?? 0,
        windCard: d.Wind?.Direction?.Localized || ""
      },
      night: {
        iconCode: n.Icon,
        temp: Math.round(df.Temperature?.Minimum?.Value ?? 0),
        phrase: n.LongPhrase || n.ShortPhrase || n.IconPhrase || "Ясно",
        pop: n.PrecipitationProbability ?? 0,
        rain: nRain, snow: nSnow, ice: nIce, total: nTotal,
        precipText: formatPrecipDetails(nRain, nSnow, nIce, nTotal),
        windSpeed: n.Wind?.Speed?.Value ? Math.round(n.Wind.Speed.Value) : null,
        windDir: n.Wind?.Direction?.Degrees ?? 0,
        windCard: n.Wind?.Direction?.Localized || ""
      }
    };
  });

  return { alertText, current, stationInfo, hourly, daily };
};

// ==========================================
// ГЛАВНЫЙ КОМПОНЕНТ ПРИЛОЖЕНИЯ
// ==========================================
export default function App() {
  const [provider, setProvider] = useState(() => localStorage.getItem('weather_provider') || 'twc');

  const envTwcKey = import.meta.env?.VITE_TWC_API_KEY || '';
  const envAccuKey = import.meta.env?.VITE_ACCU_API_KEY || '';

  const [twcKey, setTwcKey] = useState(() => envTwcKey || localStorage.getItem('twc_api_key') || '');
  const [accuKey, setAccuKey] = useState(() => envAccuKey || localStorage.getItem('accu_api_key') || '');

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempTwcKey, setTempTwcKey] = useState(twcKey);
  const [tempAccuKey, setTempAccuKey] = useState(accuKey);

  const [cityQuery, setCityQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Город по умолчанию
  const [defaultCity, setDefaultCity] = useState(() => {
    try {
      const saved = localStorage.getItem('twc_default_city');
      return saved ? JSON.parse(saved) : { name: "Минск", lat: 53.9025, lon: 27.5618 };
    } catch {
      return { name: "Минск", lat: 53.9025, lon: 27.5618 };
    }
  });

  const [coords, setCoords] = useState(defaultCity);

  // Избранные города
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem('twc_favorite_cities');
      return saved ? JSON.parse(saved) : [
        { name: "Минск", lat: 53.9025, lon: 27.5618 },
        { name: "Слуцк", lat: 52.7600, lon: 26.8400 }
      ];
    } catch {
      return [];
    }
  });

  const [normalizedData, setNormalizedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isMock, setIsMock] = useState(false);

  const hourlyScrollRef = useRef(null);

  // Запрос геолокации при первом старте
  useEffect(() => {
    const hasVisited = localStorage.getItem('weather_app_visited');
    if (!hasVisited && navigator.geolocation) {
      localStorage.setItem('weather_app_visited', 'true');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          let name = "Мое местоположение";
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=ru`);
            const d = await res.json();
            name = d.address?.city || d.address?.town || d.address?.village || name;
          } catch {}
          const newCity = { lat: Number(latitude.toFixed(4)), lon: Number(longitude.toFixed(4)), name };
          setCoords(newCity);
          setDefaultCity(newCity);
          localStorage.setItem('twc_default_city', JSON.stringify(newCity));
        },
        () => {},
        { timeout: 7000 }
      );
    }
  }, []);

  const handleSwitchProvider = (newProvider) => {
    setProvider(newProvider);
    localStorage.setItem('weather_provider', newProvider);
  };

  const handleSetCurrentAsDefault = () => {
    setDefaultCity(coords);
    localStorage.setItem('twc_default_city', JSON.stringify(coords));
  };

  const isCurrentDefault = useMemo(() => {
    return defaultCity && (
      defaultCity.name.toLowerCase() === coords.name.toLowerCase() ||
      (Math.abs(defaultCity.lat - coords.lat) < 0.05 && Math.abs(defaultCity.lon - coords.lon) < 0.05)
    );
  }, [defaultCity, coords]);

  const saveFavorites = (updatedList) => {
    setFavorites(updatedList);
    localStorage.setItem('twc_favorite_cities', JSON.stringify(updatedList));
  };

  const isCurrentFavorite = useMemo(() => {
    return favorites.some(
      f => f.name.toLowerCase() === coords.name.toLowerCase() ||
           (Math.abs(f.lat - coords.lat) < 0.05 && Math.abs(f.lon - coords.lon) < 0.05)
    );
  }, [favorites, coords]);

  const toggleFavorite = () => {
    if (isCurrentFavorite) {
      saveFavorites(favorites.filter(
        f => f.name.toLowerCase() !== coords.name.toLowerCase() &&
             !(Math.abs(f.lat - coords.lat) < 0.05 && Math.abs(f.lon - coords.lon) < 0.05)
      ));
    } else {
      saveFavorites([...favorites, { name: coords.name, lat: coords.lat, lon: coords.lon }]);
    }
  };

  const removeFavorite = (e, index) => {
    e.stopPropagation();
    saveFavorites(favorites.filter((_, idx) => idx !== index));
  };

  const scrollHourly = (direction) => {
    if (hourlyScrollRef.current) {
      hourlyScrollRef.current.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' });
    }
  };

  const handleSaveKeys = () => {
    localStorage.setItem('twc_api_key', tempTwcKey.trim());
    localStorage.setItem('accu_api_key', tempAccuKey.trim());
    setTwcKey(tempTwcKey.trim());
    setAccuKey(tempAccuKey.trim());
    setIsSettingsOpen(false);
  };

  const handleSearchCity = async (e) => {
    e.preventDefault();
    if (!cityQuery.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityQuery)}&limit=5&accept-language=ru`);
      const data = await res.json();
      setSearchResults(data);
    } catch {
      setErrorMsg("Ошибка поиска города");
    }
  };

  const handleGeoLocation = () => {
    if (!navigator.geolocation) {
      alert("Геолокация не поддерживается вашим браузером");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let name = "Мое местоположение";
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=ru`);
          const d = await res.json();
          name = d.address?.city || d.address?.town || d.address?.village || name;
        } catch {}
        setCoords({ lat: Number(latitude.toFixed(4)), lon: Number(longitude.toFixed(4)), name });
      },
      (err) => {
        alert("Не удалось определить координаты: " + err.message);
        setLoading(false);
      }
    );
  };

  // ==========================================
  // ЗАГРУЗКА ДАННЫХ
  // ==========================================
  useEffect(() => {
    let isCancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setErrorMsg(null);

      // 1. TWC
      if (provider === 'twc') {
        if (!twcKey) {
          setTimeout(() => {
            if (!isCancelled) {
              setNormalizedData(adaptTwcData({
                "v3-wx-observations-current": {
                  temperature: 13, temperatureFeelsLike: 12, wxPhraseLong: "Значительная облачность", iconCode: 28, relativeHumidity: 81, windSpeed: 18, windDirection: 120, windDirectionCardinal: "ВЮВ", pressureAltimeter: 1025.4, uvIndex: 1, uvDescription: "Низкий", visibility: 16.09, dayOrNight: "D"
                },
                "v2obs": { observation: { obs_name: coords.name, temp: 10, wx_phrase: "Облачно", valid_time_gmt: Math.floor(Date.now() / 1000) - 15 * 60 } },
                "v3-insights": [{ insightPriority: 1, insightTextLong: ["Ожидаются небольшие дожди к вечеру"] }],
                "v3-wx-forecast-hourly-1day": {
                  validTimeLocal: Array.from({ length: 24 }, (_, i) => `2026-10-21T${String(14 + i).padStart(2, '0')}:00:00+0300`),
                  temperature: Array(24).fill(12),
                  iconCode: Array(24).fill(28),
                  wxPhraseLong: [
                    "Преимущественно облачно", "Небольшой кратковременный дождь", "Облачно с прояснениями",
                    "Местами сильный ливень и гроза", "Переменная облачность", "Ясно"
                  ].concat(Array(18).fill("Облачно")),
                  qpfRain: [0, 1.2, 0, 3.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
                },
                "v3-wx-forecast-daily-15day": {
                  validTimeLocal: Array.from({ length: 15 }, (_, i) => `2026-10-${21 + i}T07:00:00+0300`),
                  calendarDayTemperatureMax: Array(15).fill(13),
                  calendarDayTemperatureMin: Array(15).fill(7),
                  daypart: [{ 
                    iconCode: Array(30).fill(28), 
                    wxPhraseLong: Array(30).fill("Облачно"),
                    qpfRain: [0, 0, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
                  }]
                }
              }));
              setIsMock(true);
              setLoading(false);
            }
          }, 150);
          return;
        }

        try {
          const url = `https://api.weather.com/v3/aggcommon/v3-wx-observations-current;v2obs;v3-wx-forecast-daily-15day;v3-wx-forecast-hourly-1day;v3-insights?geocode=${coords.lat},${coords.lon}&insightType=all&language=ru&format=json&units=m&apiKey=${twcKey}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`TWC API вернул код ${res.status}`);
          const json = await res.json();
          if (!isCancelled) {
            setNormalizedData(adaptTwcData(json));
            setIsMock(false);
          }
        } catch (err) {
          if (!isCancelled) {
            setErrorMsg(`Ошибка TWC: ${err.message}. Включен демо-режим.`);
            setIsMock(true);
          }
        } finally {
          if (!isCancelled) setLoading(false);
        }
      }

      // 2. AccuWeather
      else if (provider === 'accuweather') {
        if (!accuKey) {
          setTimeout(() => {
            if (!isCancelled) {
              setNormalizedData(adaptAccuWeatherData(
                [{
                  Temperature: { Metric: { Value: 12 } },
                  RealFeelTemperature: { 
                    Metric: { Value: 11, Phrase: "Прохладно" } 
                  },
                  WeatherText: "Значительная облачность",
                  WeatherIcon: 7,
                  IsDayTime: true,
                  Wind: { Speed: { Metric: { Value: 15 } }, Direction: { Degrees: 140, Localized: "ЮВ" } },
                  RelativeHumidity: 80,
                  Pressure: { Metric: { Value: 1018 } },
                  UVIndex: 1,
                  UVIndexText: "Низкий",
                  Visibility: { Metric: { Value: 10 } }
                }],
                Array.from({ length: 24 }, (_, i) => ({
                  DateTime: `2026-10-21T${String(14 + i).padStart(2, '0')}:00:00+03:00`,
                  WeatherIcon: 7,
                  IconPhrase: i % 2 === 0 ? "Небольшой кратковременный дождь" : "Облачно",
                  Temperature: { Value: 12 },
                  Rain: { Value: i % 4 === 0 ? 1.4 : 0 },
                  Wind: { Speed: { Value: 15 }, Direction: { Degrees: 140, Localized: "ЮВ" } }
                })),
                {
                  Headline: { Text: "Ожидаются дожди в конце недели (AccuWeather)" },
                  DailyForecasts: Array.from({ length: 15 }, (_, i) => ({
                    Date: `2026-10-${21 + i}T07:00:00+03:00`,
                    Temperature: { Maximum: { Value: 13 }, Minimum: { Value: 6 } },
                    Day: { 
                      Icon: 7, 
                      LongPhrase: "Преимущественно облачно с кратковременными прояснениями",
                      Rain: { Value: i === 1 ? 2.1 : 0 }
                    },
                    Night: { 
                      Icon: 35, 
                      LongPhrase: "Ясно и прохладно в течение всей ночи" 
                    }
                  }))
                }
              ));
              setIsMock(true);
              setLoading(false);
            }
          }, 150);
          return;
        }

        try {
          const geoUrl = `https://api.accuweather.com/locations/v1/cities/geoposition/search.json?q=${coords.lat},${coords.lon}&apikey=${accuKey}&partner=cyan&language=ru`;
          const geoRes = await fetch(geoUrl);
          if (!geoRes.ok) throw new Error(`Поиск города AccuWeather: ${geoRes.status}`);
          const geoData = await geoRes.json();
          const locationKey = geoData.Key;

          if (!locationKey) throw new Error("Ключ местоположения не найден в ответе AccuWeather");

          const [currentRes, hourlyRes, dailyRes] = await Promise.all([
            fetch(`https://api.accuweather.com/currentconditions/v1/${locationKey}.json?details=true&apikey=${accuKey}&language=ru`),
            fetch(`https://api.accuweather.com/forecasts/v1/hourly/24hour/${locationKey}.json?apikey=${accuKey}&language=ru&metric=true&details=true`),
            fetch(`https://api.accuweather.com/forecasts/v1/daily/15day/${locationKey}.json?details=true&apikey=${accuKey}&language=ru&metric=true`)
          ]);

          if (!currentRes.ok) throw new Error(`Текущие условия AccuWeather: ${currentRes.status}`);
          if (!hourlyRes.ok) throw new Error(`Почасовой прогноз AccuWeather: ${hourlyRes.status}`);
          if (!dailyRes.ok) throw new Error(`Суточный прогноз AccuWeather: ${dailyRes.status}`);

          const [currentJson, hourlyJson, dailyJson] = await Promise.all([
            currentRes.json(),
            hourlyRes.json(),
            dailyRes.json()
          ]);

          if (!isCancelled) {
            setNormalizedData(adaptAccuWeatherData(currentJson, hourlyJson, dailyJson));
            setIsMock(false);
          }
        } catch (err) {
          if (!isCancelled) {
            setErrorMsg(`Ошибка AccuWeather: ${err.message}. Включен демо-режим.`);
            setIsMock(true);
          }
        } finally {
          if (!isCancelled) setLoading(false);
        }
      }
    };

    fetchData();
    return () => { isCancelled = true; };
  }, [coords, provider, twcKey, accuKey]);

  const { alertText, current, stationInfo, hourly, daily } = normalizedData || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white font-sans antialiased pb-10 selection:bg-cyan-500 selection:text-white">
      
      {/* Шапка с адаптацией для мобильных устройств */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-slate-900/80 border-b border-white/10 px-2.5 py-1.5 sm:px-6 sm:py-2.5">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-1.5 sm:gap-3">
          
          {/* Логотип и город */}
          <div className="flex items-center gap-1.5 min-w-0 shrink">
            <div className="p-1 sm:p-1.5 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-sm shrink-0">
              <Sun className="text-white" size={16} />
            </div>
            <div className="truncate leading-tight">
              <div className="text-[10px] text-slate-400 font-medium hidden sm:block">Погода</div>
              <div className="text-xs sm:text-base font-semibold truncate flex items-center gap-0.5">
                <MapPin size={11} className="text-cyan-400 shrink-0" />
                <span className="truncate max-w-[85px] sm:max-w-[160px]">{coords.name}</span>
                {isCurrentDefault && (
                  <span className="text-[9px] bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 px-1 py-0.2 rounded-full shrink-0 hidden xs:inline-block">
                    Дефолт
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Переключатель поставщиков (компактный на мобильных) */}
          <div className="inline-flex rounded-lg bg-white/10 p-0.5 border border-white/15 shrink-0">
            <button
              onClick={() => handleSwitchProvider('twc')}
              className={`px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                provider === 'twc'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              TWC
            </button>
            <button
              onClick={() => handleSwitchProvider('accuweather')}
              className={`px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                provider === 'accuweather'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Accu
            </button>
          </div>

          {/* Правый блок: Поиск, Гео, Шестеренка */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <form onSubmit={handleSearchCity} className="relative flex items-center">
              <input
                type="text"
                placeholder="Город..."
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
                className="w-16 xs:w-20 sm:w-44 focus:w-28 sm:focus:w-44 pl-5 pr-4 py-1 text-xs rounded-lg bg-white/10 border border-white/15 focus:border-cyan-400 focus:outline-none transition-all text-white placeholder:text-slate-400"
              />
              <Search size={11} className="absolute left-1.5 text-slate-400 pointer-events-none" />
              {cityQuery && (
                <button
                  type="button"
                  onClick={() => setCityQuery('')}
                  className="absolute right-1 text-slate-400 hover:text-white"
                >
                  <X size={10} />
                </button>
              )}
            </form>

            <button
              onClick={handleGeoLocation}
              title="Мое местоположение"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/15 active:scale-95 border border-white/15 transition-all text-slate-200 shrink-0"
            >
              <Compass size={14} />
            </button>

            {/* Шестеренка: гарантированно не сожмется и не вылезет за экран */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              title="Настройки"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/15 active:scale-95 border border-white/15 transition-all text-slate-200 shrink-0"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Результаты поиска */}
        {searchResults.length > 0 && (
          <div className="max-w-4xl mx-auto mt-2 bg-slate-900/95 border border-white/20 rounded-xl overflow-hidden shadow-2xl backdrop-blur-2xl">
            {searchResults.map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCoords({
                    lat: parseFloat(parseFloat(item.lat).toFixed(4)),
                    lon: parseFloat(parseFloat(item.lon).toFixed(4)),
                    name: item.display_name.split(',')[0]
                  });
                  setSearchResults([]);
                  setCityQuery('');
                }}
                className="w-full text-left px-3.5 py-2 hover:bg-cyan-500/20 border-b border-white/5 last:border-none flex items-center justify-between text-xs sm:text-sm"
              >
                <span className="truncate pr-2">{item.display_name}</span>
                <ChevronRight size={13} className="text-slate-400 shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Панель избранных городов */}
        {favorites.length > 0 && (
          <div className="max-w-4xl mx-auto mt-1.5 pt-1 border-t border-white/10 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-xs text-slate-400 font-medium shrink-0 flex items-center gap-1 mr-0.5">
              <Star size={11} className="text-amber-400 fill-amber-400" />
              Избранное:
            </span>
            {favorites.map((fav, idx) => {
              const isActive = fav.name.toLowerCase() === coords.name.toLowerCase();
              return (
                <div
                  key={idx}
                  onClick={() => setCoords({ lat: fav.lat, lon: fav.lon, name: fav.name })}
                  className={`cursor-pointer shrink-0 flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-medium border transition-all ${
                    isActive
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200 shadow-sm'
                      : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                  }`}
                >
                  <span>{fav.name}</span>
                  <button
                    type="button"
                    onClick={(e) => removeFavorite(e, idx)}
                    className="text-slate-400 hover:text-rose-400 p-0.5"
                    title="Удалить"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </header>

      {/* Оповещения */}
      <div className="max-w-4xl mx-auto px-3 sm:px-6 pt-2">
        {isMock && (
          <div className="mb-2 px-3 py-1.5 rounded-xl bg-cyan-950/40 border border-cyan-400/30 text-cyan-200 text-xs flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <AlertCircle size={13} className="shrink-0 text-cyan-300" />
              <span><strong>Демо-режим ({provider === 'twc' ? 'Weather.com' : 'AccuWeather'}):</strong> добавьте ключ в настройках или в файл <code>.env</code>.</span>
            </span>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="px-2 py-0.5 rounded bg-cyan-400/20 hover:bg-cyan-400/30 text-xs whitespace-nowrap"
            >
              Ключи
            </button>
          </div>
        )}
        {errorMsg && (
          <div className="mb-2 px-3 py-1.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle size={13} className="shrink-0 text-rose-400" />
            <span className="truncate">{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Основной контент */}
      <main className="max-w-4xl mx-auto px-3 sm:px-6 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw size={32} className="animate-spin text-cyan-400 mb-2.5" />
            <div className="text-sm">Загрузка данных ({provider === 'twc' ? 'Weather.com' : 'AccuWeather'})...</div>
          </div>
        ) : normalizedData ? (
          <>
            {/* 1. Блок текущей погоды */}
            <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/10 via-white/5 to-white/[0.02] border border-white/20 backdrop-blur-2xl p-4 sm:p-5 shadow-lg">
              
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    
                    {/* 2. ИСПРАВЛЕНИЕ: надпись с именем поставщика без слова "Сейчас" */}
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-xs font-medium leading-tight">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      {provider === 'twc' ? 'Weather.com' : 'AccuWeather'}
                    </span>

                    {/* 1. ИСПРАВЛЕНИЕ: только звёздочка без текста */}
                    <button
                      onClick={toggleFavorite}
                      className={`p-1 rounded-full border transition-all active:scale-95 ${
                        isCurrentFavorite
                          ? 'bg-amber-400/20 border-amber-400/40 text-amber-300'
                          : 'bg-white/5 hover:bg-white/10 border-white/15 text-slate-300'
                      }`}
                      title={isCurrentFavorite ? "В избранном" : "Добавить в избранное"}
                    >
                      <Star size={14} className={isCurrentFavorite ? "fill-amber-300 text-amber-300" : ""} />
                    </button>
                  </div>

                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate leading-tight">
                    {coords.name}
                  </h1>
                  <p className="text-slate-200 text-sm sm:text-base capitalize leading-tight mt-1">
                    {current?.wxPhraseLong || "Ясно"}
                  </p>
                </div>

                <div className="flex items-center gap-3 sm:gap-5 shrink-0">
                  <div className="p-2 sm:p-2.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md">
                    <WeatherIcon
                      iconCode={current?.iconCode}
                      isDay={current?.isDay}
                      provider={provider}
                      size={44}
                      className="sm:w-12 sm:h-12"
                    />
                  </div>
                  <div>
                    <div className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-none">
                      {Math.round(current?.temperature ?? 0)}°
                    </div>
                  </div>
                </div>
              </div>

              {/* Сетка условий: 2 ряда по 3 карточки */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3.5 pt-3.5 border-t border-white/10">
                
                {/* Ветер */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 mb-0.5">
                    <span className="text-xs font-medium">Ветер</span>
                    <Wind size={13} className="text-cyan-400" />
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white leading-tight">
                    {Math.round(current?.windSpeed ?? 0)} <span className="text-xs font-normal text-slate-400">км/ч</span>
                  </div>
                  <div className="text-xs text-slate-300 flex items-center gap-1 mt-0.5 truncate">
                    <WindArrow deg={current?.windDirection ?? 0} size={11} className="text-cyan-300 shrink-0" />
                    <span className="truncate">{current?.windDirectionCardinal || "—"}</span>
                  </div>
                </div>

                {/* Влажность */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 mb-0.5">
                    <span className="text-xs font-medium">Влажность</span>
                    <Droplets size={13} className="text-blue-400" />
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white leading-tight">
                    {current?.relativeHumidity ?? 0}%
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    {current?.relativeHumidity > 70 ? "Высокая" : "Норма"}
                  </div>
                </div>

                {/* Давление */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 mb-0.5">
                    <span className="text-xs font-medium">Давление</span>
                    <Gauge size={13} className="text-emerald-400" />
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white leading-tight">
                    {current?.pressureMm ?? 760} <span className="text-xs font-normal text-slate-400">мм</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {current?.pressureHpa ?? 1013} гПа
                  </div>
                </div>

                {/* УФ-индекс */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 mb-0.5">
                    <span className="text-xs font-medium">УФ-индекс</span>
                    <Sun size={13} className="text-amber-400" />
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5 leading-tight">
                    <span>{current?.uvIndex ?? 0}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">
                      {current?.uvDescription || "Низкий"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    {current?.uvIndex > 4 ? "Защита кожи" : "Безопасно"}
                  </div>
                </div>

                {/* Видимость */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 mb-0.5">
                    <span className="text-xs font-medium">Видимость</span>
                    <Eye size={13} className="text-purple-400" />
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white leading-tight">
                    {Math.round(current?.visibility ?? 10)} <span className="text-xs font-normal text-slate-400">км</span>
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    {current?.visibility >= 10 ? "Отличная" : "Умеренная"}
                  </div>
                </div>

                {/* Карточка: Ощущается */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-slate-400 mb-0.5">
                    <span className="text-xs font-medium">Ощущ.</span>
                    <Thermometer size={13} className="text-rose-400" />
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white leading-tight">
                    {Math.round(current?.temperatureFeelsLike ?? current?.temperature ?? 0)}°
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5 truncate" title={current?.feelsLikePhrase || `Факт: ${Math.round(current?.temperature ?? 0)}°`}>
                    {current?.feelsLikePhrase ? current.feelsLikePhrase : `Факт: ${Math.round(current?.temperature ?? 0)}°`}
                  </div>
                </div>

              </div>

              {/* Предупреждение / Headline */}
              {alertText && (
                <div className="mt-2.5 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-400/30 text-amber-200 text-xs sm:text-sm flex items-center gap-2 shadow-sm">
                  <BellRing size={15} className="shrink-0 text-amber-400 animate-pulse" />
                  <span className="font-medium leading-snug">{alertText}</span>
                </div>
              )}

              {/* Метеостанция: ТОЛЬКО ДЛЯ THE WEATHER COMPANY */}
              {provider === 'twc' && stationInfo && (
                <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300 leading-tight">
                  <span className="flex items-center gap-1 text-cyan-300 font-medium">
                    <Radio size={12} className="text-cyan-400" />                    
                  </span>
                  <span className="text-white font-semibold">{stationInfo.name}</span>
                  {stationInfo.temp && <span>• {stationInfo.temp}</span>}
                  {stationInfo.phrase && <span>• {stationInfo.phrase}</span>}
                  <span className="text-slate-400">• {stationInfo.updated}</span>
                </div>
              )}

            </section>

            {/* 2. Почасовой прогноз */}
            <section className="rounded-2xl bg-white/5 border border-white/15 backdrop-blur-xl p-3 sm:p-4 shadow-lg">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="p-1 rounded-lg bg-blue-500/20 text-blue-300">
                    <Droplets size={15} />
                  </div>
                  <h2 className="text-sm sm:text-base font-bold text-white">Почасовой прогноз (24 часа)</h2>
                </div>
                
                <div className="hidden sm:flex items-center gap-1">
                  <button
                    onClick={() => scrollHourly('left')}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-all"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => scrollHourly('right')}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-all"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              {/* Горизонтальный скролл */}
              <div
                ref={hourlyScrollRef}
                className="flex gap-2 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {hourly?.map((h, idx) => {
                  const hour = new Date(h.timeStr).getHours().toString().padStart(2, '0') + ':00';
                  const precipBgClass = getPrecipitationStyle(h.rain, h.snow, h.ice, h.total);

                  return (
                    <div
                      key={idx}
                      className={`min-w-[5.75rem] w-24 shrink-0 flex flex-col items-center justify-between p-2 rounded-xl border transition-all duration-200 ${precipBgClass}`}
                    >
                      <span className="text-xs font-semibold text-slate-200">
                        {idx === 0 ? "Сейчас" : hour}
                      </span>

                      <div className="my-1">
                        <WeatherIcon
                          iconCode={h.iconCode}
                          isDay={h.isDay}
                          provider={provider}
                          size={24}
                        />
                      </div>

                      <span className="text-sm sm:text-base font-extrabold text-white leading-tight">
                        {h.temperature}°
                      </span>

                      {/* Защита от переполнения текста */}
                      <div className="w-full h-8 flex items-center justify-center my-0.5 overflow-hidden">
                        <span 
                          className="text-[11px] text-slate-300 text-center line-clamp-2 leading-tight break-words px-0.5"
                          title={h.phrase}
                        >
                          {h.phrase}
                        </span>
                      </div>

                      {/* Ветер */}
                      <div className="w-full mt-1 pt-1 border-t border-white/10 flex items-center justify-center gap-1 text-xs text-cyan-200 font-medium">
                        <WindArrow deg={h.windDirection} size={10} className="text-cyan-400" />
                        <span>{h.windDirectionCardinal}</span>
                        <span className="text-slate-300 font-normal">{h.windSpeed}</span>
                      </div>

                      {/* Осадки */}
                      <div className="w-full mt-1 flex flex-col items-center justify-center text-xs leading-tight text-center">
                        {h.precipChance > 0 ? (
                          <span className={`flex items-center gap-0.5 ${h.precipChance >= 40 ? 'text-blue-300 font-semibold' : 'text-slate-300'}`}>
                            <Droplets size={10} />
                            {h.precipChance}%
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                        {h.precipText && (
                          <span className="text-cyan-200 font-medium text-xs mt-0.5 truncate max-w-full" title={h.precipText}>
                            {h.precipText}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 3. Прогноз на 15 дней (с адаптивной цветной шкалой от -60 до +60) */}
            <section className="rounded-2xl bg-white/5 border border-white/15 backdrop-blur-xl p-3 sm:p-4 shadow-lg">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="p-1 rounded-lg bg-amber-500/20 text-amber-300">
                    <Sun size={15} />
                  </div>
                  <h2 className="text-sm sm:text-base font-bold text-white">Прогноз на 15 дней</h2>
                </div>
                <span className="text-xs text-slate-400">День / Ночь</span>
              </div>

              <div className="space-y-2">
                {daily?.map((dItem, dayIdx) => {
                  const date = new Date(dItem.timeStr);
                  const dayName = dayIdx === 0 ? "Сегодня" : dItem.dayName;
                  const formattedDate = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

                  const dayPrecipBg = getPrecipitationStyle(dItem.day.rain, dItem.day.snow, dItem.day.ice, dItem.day.total);
                  const nightPrecipBg = getPrecipitationStyle(dItem.night.rain, dItem.night.snow, dItem.night.ice, dItem.night.total);

                  // 3. ИСПРАВЛЕНИЕ: Расчет диапазона от -60°C до +60°C (всего 120 градусов)
                  const minPercent = Math.max(0, Math.min(100, ((dItem.minTemp - (-60)) / 120) * 100));
                  const maxPercent = Math.max(0, Math.min(100, ((dItem.maxTemp - (-60)) / 120) * 100));
                  
                  // Получение цветов краев температурного отрезка
                  const minColor = getTempColor(dItem.minTemp);
                  const maxColor = getTempColor(dItem.maxTemp);

                  return (
                    <div
                      key={dayIdx}
                      className="p-2.5 sm:p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex flex-col gap-2"
                    >
                      {/* Шапка дня с адаптивной цветной шкалой от -60 до +60 */}
                      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm sm:text-base font-bold min-w-16 ${dayIdx === 0 ? 'text-cyan-400' : 'text-white'}`}>
                            {dayName}
                          </span>
                          <span className="text-xs text-slate-300">
                            {formattedDate}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 w-44 sm:w-60">
                          <span className="text-xs sm:text-sm font-semibold text-slate-300 w-6 text-right">
                            {dItem.minTemp}°
                          </span>

                          {/* Фоновый трек шкалы (-60 до +60) с адаптивным цветным градиентом */}
                          <div className="relative flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="absolute top-0 bottom-0 rounded-full transition-all duration-300 shadow-sm"
                              style={{
                                left: `${minPercent}%`,
                                width: `${Math.max(4, maxPercent - minPercent)}%`,
                                background: `linear-gradient(to right, ${minColor}, ${maxColor})`
                              }}
                            />
                          </div>

                          <span className="text-xs sm:text-sm font-bold text-white w-6 text-left">
                            {dItem.maxTemp}°
                          </span>
                        </div>
                      </div>

                      {/* Горизонтальный ряд: Блок День и Блок Ночь */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        
                        {/* ДЕНЬ */}
                        <div className={`flex items-start justify-between gap-2 rounded-xl p-2.5 border transition-colors ${dayPrecipBg}`}>
                          <div className="flex items-start gap-2.5 min-w-0">
                            
                            <div className="flex flex-col items-center justify-center shrink-0 w-14 text-center">
                              <div className="p-1 rounded-lg bg-amber-500/10">
                                <WeatherIcon
                                  iconCode={dItem.day.iconCode}
                                  isDay={true}
                                  provider={provider}
                                  size={22}
                                />
                              </div>
                              <div className="mt-1 flex flex-col items-center text-xs text-blue-200 font-medium leading-tight">
                                {dItem.day.pop > 0 ? (
                                  <span className="flex items-center gap-0.5">
                                    <Droplets size={10} />
                                    {dItem.day.pop}%
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">0%</span>
                                )}
                                {dItem.day.precipText && (
                                  <span className="text-cyan-200 mt-0.5 font-semibold text-xs whitespace-nowrap">
                                    {dItem.day.precipText}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-amber-200 leading-tight">
                                День: <span className="text-sm font-bold text-amber-300">{dItem.day.temp}°</span>
                              </div>
                              <div className="text-xs text-slate-200 whitespace-normal leading-snug mt-1">
                                {dItem.day.phrase}
                              </div>
                            </div>
                          </div>

                          {dItem.day.windSpeed !== null && (
                            <div className="shrink-0 text-xs text-slate-300 flex items-center gap-1 pl-1 self-start pt-0.5 whitespace-nowrap">
                              <WindArrow deg={dItem.day.windDir} size={11} className="text-cyan-300" />
                              <span>{dItem.day.windCard} {dItem.day.windSpeed} км/ч</span>
                            </div>
                          )}
                        </div>

                        {/* НОЧЬ */}
                        <div className={`flex items-start justify-between gap-2 rounded-xl p-2.5 border transition-colors ${nightPrecipBg}`}>
                          <div className="flex items-start gap-2.5 min-w-0">
                            
                            <div className="flex flex-col items-center justify-center shrink-0 w-14 text-center">
                              <div className="p-1 rounded-lg bg-indigo-500/10">
                                <WeatherIcon
                                  iconCode={dItem.night.iconCode}
                                  isDay={false}
                                  provider={provider}
                                  size={22}
                                />
                              </div>
                              <div className="mt-1 flex flex-col items-center text-xs text-blue-200 font-medium leading-tight">
                                {dItem.night.pop > 0 ? (
                                  <span className="flex items-center gap-0.5">
                                    <Droplets size={10} />
                                    {dItem.night.pop}%
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">0%</span>
                                )}
                                {dItem.night.precipText && (
                                  <span className="text-cyan-200 mt-0.5 font-semibold text-xs whitespace-nowrap">
                                    {dItem.night.precipText}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-indigo-200 leading-tight">
                                Ночь: <span className="text-sm font-bold text-indigo-300">{dItem.night.temp}°</span>
                              </div>
                              <div className="text-xs text-slate-200 whitespace-normal leading-snug mt-1">
                                {dItem.night.phrase}
                              </div>
                            </div>
                          </div>

                          {dItem.night.windSpeed !== null && (
                            <div className="shrink-0 text-xs text-slate-300 flex items-center gap-1 pl-1 self-start pt-0.5 whitespace-nowrap">
                              <WindArrow deg={dItem.night.windDir} size={11} className="text-cyan-300" />
                              <span>{dItem.night.windCard} {dItem.night.windSpeed} км/ч</span>
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </main>

      {/* Модальное окно настроек */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-sm bg-slate-900 border border-white/20 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <Settings size={18} className="text-cyan-400" />
                Настройки приложения
              </h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* Выбор города по умолчанию */}
            <div className="mb-4 pb-3 border-b border-white/10">
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Город по умолчанию при старте:
              </label>
              <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-2.5">
                <div className="truncate">
                  <div className="text-xs text-slate-400">Текущий выбор:</div>
                  <div className="text-sm font-bold text-white truncate">{defaultCity?.name}</div>
                </div>
                {!isCurrentDefault ? (
                  <button
                    onClick={handleSetCurrentAsDefault}
                    className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/40 text-xs font-medium transition-all"
                  >
                    Сделать {coords.name} основным
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium px-2 py-1 bg-emerald-500/10 rounded-lg">
                    <Check size={13} /> Выбран
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-3 leading-snug">
              Ключи сохраняются локально или считываются из <code>.env</code> (переменные <code>VITE_TWC_API_KEY</code> и <code>VITE_ACCU_API_KEY</code>).
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-cyan-300 block mb-1">
                  Weather.com (TWC) Key:
                </label>
                <input
                  type="text"
                  value={tempTwcKey}
                  onChange={(e) => setTempTwcKey(e.target.value)}
                  placeholder="API Key для Weather.com..."
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-amber-300 block mb-1">
                  AccuWeather API Key:
                </label>
                <input
                  type="text"
                  value={tempAccuKey}
                  onChange={(e) => setTempAccuKey(e.target.value)}
                  placeholder="API Key для AccuWeather..."
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSaveKeys}
                  className="flex-1 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTempTwcKey('');
                    setTempAccuKey('');
                    localStorage.removeItem('twc_api_key');
                    localStorage.removeItem('accu_api_key');
                    setTwcKey('');
                    setAccuKey('');
                    setIsSettingsOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs"
                >
                  Очистить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}