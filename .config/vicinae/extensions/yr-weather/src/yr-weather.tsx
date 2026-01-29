import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  Action,
  ActionPanel,
  getPreferenceValues,
  Icon,
  List,
  showToast,
  Toast,
} from "@vicinae/api";
import { useEffect, useState } from "react";
import {
  fetchWeather,
  buildForecastUrl,
  formatDate,
  formatHumidity,
  formatPrecipitation,
  formatPressure,
  formatTemperature,
  formatWindDirection,
  formatWindSpeed,
  getSymbolIcon,
  groupByDay,
} from "./api";
import type { DailyForecast, YrPreferences } from "./types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 60 * 1000, // 30 minutes - weather doesn't change that often
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function DailyForecastItem({
  forecast,
  apiUrl,
  onToggleDetail,
}: {
  forecast: DailyForecast;
  apiUrl?: string;
  onToggleDetail: () => void;
}) {
  const icon = getSymbolIcon(forecast.symbolCode);
  const tempRange =
    forecast.temperature.min !== undefined &&
    forecast.temperature.max !== undefined
      ? `${formatTemperature(forecast.temperature.min)} - ${formatTemperature(forecast.temperature.max)}`
      : formatTemperature(forecast.temperature.current);

  return (
    <List.Item
      title={forecast.day}
      subtitle={formatDate(forecast.date)}
      icon={icon}
      accessories={[
        { text: tempRange },
        ...(forecast.precipitation.amount !== undefined &&
        forecast.precipitation.amount > 0
          ? [{ text: formatPrecipitation(forecast.precipitation.amount) }]
          : []),
      ]}
      actions={
        <ActionPanel>
          <Action
            title="Toggle Detail"
            icon={Icon.AppWindowSidebarLeft}
            onAction={onToggleDetail}
            shortcut={{ modifiers: ["cmd"], key: "d" }}
          />
          <Action.CopyToClipboard
            title="Copy Weather Summary"
            content={`${forecast.day} (${formatDate(forecast.date)}): ${tempRange}, ${formatPrecipitation(forecast.precipitation.amount)} precipitation`}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <ActionPanel.Section title="Source">
            <Action
              title="Refresh"
              icon={Icon.Repeat}
              onAction={() =>
                queryClient.invalidateQueries({ queryKey: ["yr-weather"] })
              }
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
            {apiUrl ? (
              <Action.OpenInBrowser
                title="Open API URL"
                url={apiUrl}
                shortcut={{ modifiers: ["cmd"], key: "o" }}
              />
            ) : null}
            {apiUrl ? (
              <Action.CopyToClipboard
                title="Copy API URL"
                content={apiUrl}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              />
            ) : null}
          </ActionPanel.Section>
          <ActionPanel.Section title="Details">
            <Action.CopyToClipboard
              title="Copy Temperature"
              content={tempRange}
              shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
            />
            {forecast.precipitation.amount !== undefined && (
              <Action.CopyToClipboard
                title="Copy Precipitation"
                content={formatPrecipitation(forecast.precipitation.amount)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
              />
            )}
            {forecast.windSpeed !== undefined && (
              <Action.CopyToClipboard
                title="Copy Wind Speed"
                content={`${formatWindSpeed(forecast.windSpeed)} ${formatWindDirection(forecast.windDirection)}`}
                shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
              />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
      detail={
        <List.Item.Detail
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label
                title="Date"
                text={formatDate(forecast.date)}
              />
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.Label
                title="Temperature"
                text={tempRange}
                icon="🌡️"
              />
              {forecast.temperature.current !== undefined && (
                <List.Item.Detail.Metadata.Label
                  title="Current"
                  text={formatTemperature(forecast.temperature.current)}
                />
              )}
              {forecast.precipitation.amount !== undefined && (
                <>
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label
                    title="Precipitation"
                    text={formatPrecipitation(forecast.precipitation.amount)}
                    icon="💧"
                  />
                  {forecast.precipitation.probability !== undefined && (
                    <List.Item.Detail.Metadata.Label
                      title="Probability"
                      text={`${Math.round(forecast.precipitation.probability)}%`}
                    />
                  )}
                </>
              )}
              {forecast.windSpeed !== undefined && (
                <>
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label
                    title="Wind"
                    text={`${formatWindSpeed(forecast.windSpeed)} ${formatWindDirection(forecast.windDirection)}`}
                    icon="💨"
                  />
                </>
              )}
              {forecast.humidity !== undefined && (
                <>
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label
                    title="Humidity"
                    text={formatHumidity(forecast.humidity)}
                  />
                </>
              )}
              {forecast.pressure !== undefined && (
                <>
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label
                    title="Pressure"
                    text={formatPressure(forecast.pressure)}
                  />
                </>
              )}
            </List.Item.Detail.Metadata>
          }
        />
      }
    />
  );
}

function YrWeatherContent() {
  const preferences = getPreferenceValues<YrPreferences>();
  const [showingDetail, setShowingDetail] = useState(true);
  const queryKey = [
    "yr-weather",
    preferences.latitude,
    preferences.longitude,
    preferences.altitude,
  ];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      fetchWeather(
        preferences.latitude,
        preferences.longitude,
        preferences.altitude,
      ),
    enabled: !!preferences.latitude && !!preferences.longitude,
  });

  useEffect(() => {
    if (isError && error) {
      console.error("[Yr Weather] Error:", error);
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to fetch weather",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [isError, error]);

  const dailyForecasts = data
    ? groupByDay(data.properties.timeseries).slice(0, 10)
    : [];

  const locationTitle = preferences.locationName || "Weather Forecast";
  const apiUrl =
    preferences.latitude && preferences.longitude
      ? buildForecastUrl(
          preferences.latitude,
          preferences.longitude,
          preferences.altitude,
        )
      : undefined;

  return (
    <List isLoading={isLoading} isShowingDetail={showingDetail}>
      {!data && !isLoading && !isError ? (
			<List.EmptyView
				title="Configure Location"
				description="Set your latitude and longitude in extension preferences"
				icon={Icon.XMarkCircle}
			/>
      ) : dailyForecasts.length === 0 && !isLoading ? (
        <List.EmptyView
          title="No weather data"
          description="Unable to fetch forecast for this location"
          icon={Icon.XMarkCircle}
        />
      ) : (
        <List.Section title={locationTitle}>
          {dailyForecasts.map((forecast) => (
            <DailyForecastItem
              key={forecast.date}
              forecast={forecast}
              apiUrl={apiUrl}
              onToggleDetail={() => setShowingDetail(!showingDetail)}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}

export default function YrWeather() {
  return (
    <QueryClientProvider client={queryClient}>
      <YrWeatherContent />
    </QueryClientProvider>
  );
}
