import type { DailyForecast, TimeseriesEntry, WeatherData } from "./types";

const USER_AGENT = "Vicinae YrWeather Extension/1.0 (https://github.com/fbosch/dotfiles)";
const API_BASE_URL = "https://api.met.no/weatherapi/locationforecast/2.0";

export function buildForecastUrl(
	latitude: string,
	longitude: string,
	altitude?: string,
): string {
	const lat = Number.parseFloat(latitude);
	const lon = Number.parseFloat(longitude);

	if (Number.isNaN(lat) || Number.isNaN(lon)) {
		throw new Error("Invalid latitude or longitude");
	}

	if (lat < -90 || lat > 90) {
		throw new Error("Latitude must be between -90 and 90");
	}

	if (lon < -180 || lon > 180) {
		throw new Error("Longitude must be between -180 and 180");
	}

	const params = new URLSearchParams({
		lat: lat.toString(),
		lon: lon.toString(),
	});

	if (altitude) {
		const alt = Number.parseInt(altitude, 10);
		if (!Number.isNaN(alt)) {
			params.append("altitude", alt.toString());
		}
	}

	return `${API_BASE_URL}/compact?${params.toString()}`;
}

export async function fetchWeather(
	latitude: string,
	longitude: string,
	altitude?: string,
): Promise<WeatherData> {
	const url = buildForecastUrl(latitude, longitude, altitude);

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				"User-Agent": USER_AGENT,
			},
		});

		if (!response.ok) {
			if (response.status === 403) {
				throw new Error(
					"Access forbidden. The Yr.no API may have blocked this request.",
				);
			}
			throw new Error(
				`Weather API request failed: ${response.status} ${response.statusText}`,
			);
		}

		return (await response.json()) as WeatherData;
	} catch (error) {
		console.error("[Yr Weather] Fetch error:", error);
		if (error instanceof Error) {
			throw error;
		}
		throw new Error("Failed to fetch weather data");
	}
}

export function getDayName(dateStr: string): string {
	const date = new Date(dateStr);
	const today = new Date();
	const tomorrow = new Date(today);
	tomorrow.setDate(tomorrow.getDate() + 1);

	if (date.toDateString() === today.toDateString()) {
		return "Today";
	}
	if (date.toDateString() === tomorrow.toDateString()) {
		return "Tomorrow";
	}

	return date.toLocaleDateString("en-US", { weekday: "long" });
}

export function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

export function getSymbolIcon(symbolCode: string): string {
	const base = symbolCode.replace(/_day|_night|_polartwilight/g, "");
	const icons: Record<string, string> = {
		clearsky: "☀️",
		fair: "🌤️",
		partlycloudy: "⛅",
		cloudy: "☁️",
		fog: "🌫️",
		heavyrain: "🌧️",
		heavyrainandthunder: "⛈️",
		heavyrainshowers: "🌧️",
		heavyrainshowersandthunder: "⛈️",
		heavysleet: "🌨️",
		heavysleetandthunder: "⛈️",
		heavysleetshowers: "🌨️",
		heavysleetshowersandthunder: "⛈️",
		heavysnow: "🌨️",
		heavysnowandthunder: "⛈️",
		heavysnowshowers: "🌨️",
		heavysnowshowersandthunder: "⛈️",
		lightrain: "🌦️",
		lightrainandthunder: "⛈️",
		lightrainshowers: "🌦️",
		lightrainshowersandthunder: "⛈️",
		lightsleet: "🌨️",
		lightsleetandthunder: "⛈️",
		lightsleetshowers: "🌨️",
		lightsnow: "🌨️",
		lightsnowandthunder: "⛈️",
		lightsnowshowers: "🌨️",
		lightssleetshowersandthunder: "⛈️",
		lightssnowshowersandthunder: "⛈️",
		rain: "🌧️",
		rainandthunder: "⛈️",
		rainshowers: "🌦️",
		rainshowersandthunder: "⛈️",
		sleet: "🌨️",
		sleetandthunder: "⛈️",
		sleetshowers: "🌨️",
		sleetshowersandthunder: "⛈️",
		snow: "🌨️",
		snowandthunder: "⛈️",
		snowshowers: "🌨️",
		snowshowersandthunder: "⛈️",
	};

	return icons[base] || "🌡️";
}

export function groupByDay(timeseries: TimeseriesEntry[]): DailyForecast[] {
	const dailyMap = new Map<string, DailyForecast>();

	for (const entry of timeseries) {
		const date = entry.time.split("T")[0];

		if (!dailyMap.has(date)) {
			const symbolCode =
				entry.data.next_6_hours?.summary.symbol_code ||
				entry.data.next_1_hours?.summary.symbol_code ||
				entry.data.next_12_hours?.summary.symbol_code ||
				"clearsky_day";

			dailyMap.set(date, {
				date,
				day: getDayName(entry.time),
				temperature: {
					current: entry.data.instant.details.air_temperature,
					min: undefined,
					max: undefined,
				},
				precipitation: {
					amount: undefined,
					min: undefined,
					max: undefined,
					probability: undefined,
				},
				symbolCode,
				windSpeed: entry.data.instant.details.wind_speed,
				windDirection: entry.data.instant.details.wind_from_direction,
				humidity: entry.data.instant.details.relative_humidity,
				pressure: entry.data.instant.details.air_pressure_at_sea_level,
			});
		}

		const daily = dailyMap.get(date);
		if (!daily) continue;

		const temp = entry.data.instant.details.air_temperature;
		if (temp !== undefined) {
			if (daily.temperature.min === undefined || temp < daily.temperature.min) {
				daily.temperature.min = temp;
			}
			if (daily.temperature.max === undefined || temp > daily.temperature.max) {
				daily.temperature.max = temp;
			}
		}

		if (entry.data.next_6_hours?.details) {
			const details = entry.data.next_6_hours.details;
			if (details.air_temperature_min !== undefined) {
				daily.temperature.min = details.air_temperature_min;
			}
			if (details.air_temperature_max !== undefined) {
				daily.temperature.max = details.air_temperature_max;
			}
			if (details.precipitation_amount !== undefined) {
				daily.precipitation.amount = details.precipitation_amount;
			}
			if (details.precipitation_amount_min !== undefined) {
				daily.precipitation.min = details.precipitation_amount_min;
			}
			if (details.precipitation_amount_max !== undefined) {
				daily.precipitation.max = details.precipitation_amount_max;
			}
			if (details.probability_of_precipitation !== undefined) {
				daily.precipitation.probability = details.probability_of_precipitation;
			}
		}

		if (entry.data.next_1_hours?.details) {
			const details = entry.data.next_1_hours.details;
			if (
				daily.precipitation.amount === undefined &&
				details.precipitation_amount !== undefined
			) {
				daily.precipitation.amount = details.precipitation_amount;
			}
		}
	}

	return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function formatTemperature(temp: number | undefined): string {
	if (temp === undefined) return "—";
	return `${Math.round(temp)}°C`;
}

export function formatWindSpeed(speed: number | undefined): string {
	if (speed === undefined) return "—";
	return `${speed.toFixed(1)} m/s`;
}

export function formatWindDirection(degrees: number | undefined): string {
	if (degrees === undefined) return "";

	const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
	const index = Math.round(((degrees % 360) / 45) % 8);
	return directions[index];
}

export function formatPrecipitation(amount: number | undefined): string {
	if (amount === undefined) return "—";
	if (amount === 0) return "0 mm";
	return `${amount.toFixed(1)} mm`;
}

export function formatHumidity(humidity: number | undefined): string {
	if (humidity === undefined) return "—";
	return `${Math.round(humidity)}%`;
}

export function formatPressure(pressure: number | undefined): string {
	if (pressure === undefined) return "—";
	return `${Math.round(pressure)} hPa`;
}
