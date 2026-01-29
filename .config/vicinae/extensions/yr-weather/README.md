# Yr Weather

Weather forecast from Yr.no (Norwegian Meteorological Institute) directly in Vicinae.

## Features

- 10-day weather forecast for any location on Earth
- Temperature, precipitation, wind, humidity, and pressure data
- Detailed weather information with expandable views
- Automatic caching (30 minutes) to reduce API calls
- Data from the Norwegian Meteorological Institute's official API

## Setup

### 1. Find Your Coordinates

You can find your latitude and longitude using:
- Google Maps: Right-click any location and select the coordinates
- [latlong.net](https://www.latlong.net/)
- Your favorite mapping service

### 2. Configure the Extension

1. Open Vicinae settings
2. Navigate to Extensions → Yr Weather
3. Enter your coordinates:
   - **Latitude**: Decimal degrees (e.g., `59.9139` for Oslo)
   - **Longitude**: Decimal degrees (e.g., `10.7522` for Oslo)
   - **Altitude** (optional): Ground surface height in meters (improves temperature accuracy)
   - **Location Name** (optional): A friendly name like "Home" or "Oslo"

## Usage

1. Open Vicinae
2. Type "Weather Forecast" or "yr" to activate the extension
3. Browse through the 10-day forecast
4. Press `Enter` or `Space` to view detailed information for a specific day
5. Use keyboard shortcuts for quick actions:
   - `Cmd+C` - Copy weather summary
   - `Cmd+Shift+T` - Copy temperature
   - `Cmd+Shift+P` - Copy precipitation
   - `Cmd+Shift+W` - Copy wind information

## Data Source

This extension uses the [Locationforecast API](https://api.met.no/weatherapi/locationforecast/2.0/documentation) from the Norwegian Meteorological Institute (MET Norway).

- Weather data is provided free of charge
- Forecasts are updated regularly
- Coverage: Global (best accuracy in Nordic and Arctic regions)
- Forecast period: Up to 10 days

## Privacy

All weather data is fetched directly from the MET Norway API. No data is stored or sent to third parties. The extension caches weather data locally for 30 minutes to reduce API calls.

## Attribution

Weather data provided by the [Norwegian Meteorological Institute](https://www.met.no/) under [Norwegian License for Open Government Data (NLOD) 2.0](https://data.norge.no/nlod/en/2.0).

## Troubleshooting

### "Failed to fetch weather"

- Check that your latitude and longitude are valid
- Ensure you have an active internet connection
- The API may be temporarily unavailable

### Invalid coordinates error

- Latitude must be between -90 and 90
- Longitude must be between -180 and 180
- Use decimal format (e.g., `59.9139`, not `59°54'50"N`)

### Temperature seems incorrect

Try adding your location's altitude in the settings for more accurate temperature readings.
