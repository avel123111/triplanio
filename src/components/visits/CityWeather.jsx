import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWeather, weatherInfo } from '@/lib/weather';
import { DateTime } from 'luxon';

/**
 * Compact weather row. Date range is computed in the city's local timezone
 * so the weather forecast matches the days the user is actually there.
 */
export default function CityWeather({ visit }) {
  const tz = visit?.timezone || 'UTC';
  const start = visit?.start_datetime
    ? DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
    : null;
  const end = visit?.end_datetime
    ? DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
    : null;
  const { data: weather, isLoading } = useQuery({
    queryKey: ['weather', visit?.id, start, end],
    queryFn: () => getWeather(visit.latitude, visit.longitude, start, end),
    enabled: !!visit && !!start,
  });

  if (!visit || isLoading) return null;
  if (!weather || weather.historical || !weather.daily?.time?.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {weather.daily.time.slice(0, 7).map((d, i) => {
        const info = weatherInfo(weather.daily.weather_code[i]);
        return (
          <div key={d} className="flex flex-col items-center justify-center w-[68px] py-2 rounded-xl bg-secondary/70">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{DateTime.fromISO(d).toFormat('LLL d')}</span>
            <span className="text-2xl leading-none my-1">{info.icon}</span>
            <span className="text-sm font-bold">{Math.round(weather.daily.temperature_2m_max[i])}°</span>
          </div>
        );
      })}
    </div>
  );
}