# Urban Air Quality Assistant — Backend

Node.js backend service providing real-time air quality context (via Open-Meteo Geocoding & Air Quality API) and winter smog action plans (Indoor Air Hacks, Low-Emission Routines, and Sustainable Alternatives & Impact) powered by Google Gemini API with safe fallback support.

## Endpoints
- `GET /api/health` — Health check
- `GET /api/cities` — Preset urban cities
- `POST /api/recommendations` — Accepts `{ city, aqiLevel, lifestyle }` and returns structured recommendations
-
