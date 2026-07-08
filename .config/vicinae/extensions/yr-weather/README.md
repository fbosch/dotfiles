# Yr Weather

Weather forecast in Vicinae using MET Norway's Yr/Locationforecast API.

## Command

`Weather Forecast` shows a multi-day forecast for configured coordinates. Details include temperature, precipitation, wind, humidity, and pressure where the API provides them.

## Setup

Find latitude and longitude with:

- Google Maps: Right-click any location and select the coordinates
- [latlong.net](https://www.latlong.net/)
- Any mapping service that returns decimal coordinates

Configure these Vicinae preferences:

- Latitude in decimal degrees, for example `59.9139`.
- Longitude in decimal degrees, for example `10.7522`.
- Optional altitude in meters. This can improve temperature accuracy.
- Optional location name for display.

## Usage

1. Run `Weather Forecast` from Vicinae.
2. Browse the forecast list.
3. Press `Enter` or `Space` for day details.
4. Use `Cmd+C`, `Cmd+Shift+T`, `Cmd+Shift+P`, or `Cmd+Shift+W` to copy summary, temperature, precipitation, or wind details.

## Data Source

This extension uses the [Locationforecast API](https://api.met.no/weatherapi/locationforecast/2.0/documentation) from the Norwegian Meteorological Institute (MET Norway).

- Coverage is global, with best accuracy in Nordic and Arctic regions.
- Forecast period is up to 10 days.
- Results are cached locally to reduce API calls.

## Privacy

Weather data is fetched directly from MET Norway. Coordinates are sent to that API and cached locally by the extension.

## Attribution

Weather data provided by the [Norwegian Meteorological Institute](https://www.met.no/) under [Norwegian License for Open Government Data (NLOD) 2.0](https://data.norge.no/nlod/en/2.0).

## Troubleshooting

- Failed fetch: check coordinates, network access, and MET Norway API availability.
- Invalid coordinates: latitude must be `-90` to `90`; longitude must be `-180` to `180`; use decimal format.
- Incorrect temperature: add altitude in preferences.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```
