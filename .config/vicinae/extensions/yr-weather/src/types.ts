export interface YrPreferences {
	latitude: string;
	longitude: string;
	altitude?: string;
	locationName?: string;
}

export interface WeatherData {
	type: string;
	geometry: {
		type: string;
		coordinates: number[];
	};
	properties: {
		meta: {
			updated_at: string;
			units: {
				air_pressure_at_sea_level: string;
				air_temperature: string;
				cloud_area_fraction: string;
				precipitation_amount: string;
				relative_humidity: string;
				wind_from_direction: string;
				wind_speed: string;
			};
		};
		timeseries: TimeseriesEntry[];
	};
}

export interface TimeseriesEntry {
	time: string;
	data: {
		instant: {
			details: {
				air_pressure_at_sea_level?: number;
				air_temperature?: number;
				cloud_area_fraction?: number;
				relative_humidity?: number;
				wind_from_direction?: number;
				wind_speed?: number;
				fog_area_fraction?: number;
				dew_point_temperature?: number;
				ultraviolet_index_clear_sky?: number;
			};
		};
		next_1_hours?: {
			summary: {
				symbol_code: string;
			};
			details: {
				precipitation_amount?: number;
				precipitation_amount_min?: number;
				precipitation_amount_max?: number;
				probability_of_precipitation?: number;
			};
		};
		next_6_hours?: {
			summary: {
				symbol_code: string;
			};
			details: {
				air_temperature_max?: number;
				air_temperature_min?: number;
				precipitation_amount?: number;
				precipitation_amount_min?: number;
				precipitation_amount_max?: number;
				probability_of_precipitation?: number;
			};
		};
		next_12_hours?: {
			summary: {
				symbol_code: string;
			};
			details: {
				probability_of_precipitation?: number;
			};
		};
	};
}

export interface DailyForecast {
	date: string;
	day: string;
	temperature: {
		current?: number;
		min?: number;
		max?: number;
	};
	precipitation: {
		amount?: number;
		min?: number;
		max?: number;
		probability?: number;
	};
	symbolCode: string;
	windSpeed?: number;
	windDirection?: number;
	humidity?: number;
	pressure?: number;
}
