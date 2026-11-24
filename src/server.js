const http = require("http");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const FALLBACK_CITIES = {
  kolkata: { city: "Kolkata", latitude: 22.5726, longitude: 88.3639, usAqi: 185, pm25: 118, pm10: 192 },
  "new delhi": { city: "New Delhi", latitude: 28.6139, longitude: 77.209, usAqi: 310, pm25: 235, pm10: 340 },
  bardhaman: { city: "Bardhaman", latitude: 23.2324, longitude: 87.8615, usAqi: 162, pm25: 94, pm10: 158 },
  mumbai: { city: "Mumbai", latitude: 19.076, longitude: 72.8777, usAqi: 125, pm25: 58, pm10: 105 },
  bengaluru: { city: "Bengaluru", latitude: 12.9716, longitude: 77.5946, usAqi: 78, pm25: 29, pm10: 64 }
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

async function fetchLiveAqi(cityName) {
  const cleanCity = (cityName || "Kolkata").trim();
  const key = cleanCity.toLowerCase();
  const fallback = FALLBACK_CITIES[key] || {
    city: cleanCity,
    latitude: 22.5726,
    longitude: 88.3639,
    usAqi: 170,
    pm25: 98,
    pm10: 165
  };

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    const place = geoData && geoData.results && geoData.results[0];
    if (!place) return fallback;

    const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.latitude}&longitude=${place.longitude}&current=us_aqi,pm10,pm2_5`;
    const aqiRes = await fetch(aqiUrl);
    const aqiData = await aqiRes.json();
    const current = aqiData && aqiData.current;

    return {
      city: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      usAqi: current && typeof current.us_aqi === "number" ? current.us_aqi : fallback.usAqi,
      pm25: current && typeof current.pm2_5 === "number" ? current.pm2_5 : fallback.pm25,
      pm10: current && typeof current.pm10 === "number" ? current.pm10 : fallback.pm10
    };
  } catch (_) {
    return fallback;
  }
}

function buildFallbackPlan(aqiData, aqiLevel, lifestyle) {
  const severity = aqiLevel || (aqiData.usAqi >= 201 ? "Severe" : aqiData.usAqi >= 101 ? "Poor" : "Moderate");
  const sensitive = lifestyle && lifestyle.sensitiveGroup ? lifestyle.sensitiveGroup : "General household";

  return {
    city: aqiData.city,
    aqiSeverity: severity,
    airQuality: {
      usAqi: aqiData.usAqi,
      pm25: aqiData.pm25,
      pm10: aqiData.pm10
    },
    indoorHacks: [
      `Keep windows and doors tightly sealed during peak winter smog hours (early morning and late evening) in ${aqiData.city}.`,
      "Use a damp microfiber cloth instead of dry sweeping to trap settled PM2.5 and PM10 dust without re-suspending particles.",
      `Prioritize clean indoor air for ${sensitive} using HEPA filtration or DIY box-fan MERV-13 filter setup.`
    ],
    lowEmissionRoutine: [
      "Shift outdoor errands and exercise to mid-afternoon when atmospheric dispersion is relatively better.",
      "Combine trips or use public transit/carpooling instead of short solo vehicle runs.",
      "Avoid open biomass/leaf/waste burning and turn off appliances when not in use."
    ],
    sustainableAlternatives: [
      {
        swap: "N95/FFP2 well-fitted mask + indoor air quality check before stepping out",
        impact: "Reduces inhaled fine particulate matter (PM2.5) and lowers acute airway irritation during smog spikes."
      },
      {
        swap: "Public transit or shared commute instead of personal vehicle during high-AQI days",
        impact: "Cuts tailpipe nitrogen oxides and particulate emissions while lowering household fuel spend."
      }
    ],
    source: "fallback-engine"
  };
}

async function generateGeminiAdvice(aqiData, aqiLevel, lifestyle) {
  const fallback = buildFallbackPlan(aqiData, aqiLevel, lifestyle);
  if (!GEMINI_API_KEY) return fallback;

  try {
    const prompt = `You are an Urban Air Quality Assistant helping urban families manage winter smog.
Input data:
- City: ${aqiData.city}
- Current US AQI: ${aqiData.usAqi}, PM2.5: ${aqiData.pm25}, PM10: ${aqiData.pm10}
- Selected Severity: ${aqiLevel || "Auto"}
- Lifestyle: ${JSON.stringify(lifestyle || {})}

Return strictly valid JSON with keys:
"indoorHacks" (array of 3 concise practical strings),
"lowEmissionRoutine" (array of 3 concise daily routine strings),
"sustainableAlternatives" (array of 2 objects with "swap" and "impact").`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) return fallback;
    const data = await response.json();
    const rawText = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!rawText) return fallback;

    const parsed = JSON.parse(rawText);
    return {
      city: aqiData.city,
      aqiSeverity: aqiLevel || fallback.aqiSeverity,
      airQuality: fallback.airQuality,
      indoorHacks: Array.isArray(parsed.indoorHacks) && parsed.indoorHacks.length ? parsed.indoorHacks : fallback.indoorHacks,
      lowEmissionRoutine: Array.isArray(parsed.lowEmissionRoutine) && parsed.lowEmissionRoutine.length ? parsed.lowEmissionRoutine : fallback.lowEmissionRoutine,
      sustainableAlternatives: Array.isArray(parsed.sustainableAlternatives) && parsed.sustainableAlternatives.length ? parsed.sustainableAlternatives : fallback.sustainableAlternatives,
      source: "gemini-2.5-flash"
    };
  } catch (_) {
    return fallback;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { status: "ok", service: "urban-air-quality-backend" });
  }

  if (req.method === "GET" && url.pathname === "/api/cities") {
    return sendJson(res, 200, { cities: Object.values(FALLBACK_CITIES).map((c) => c.city) });
  }

  if ((req.method === "POST" || req.method === "GET") && url.pathname === "/api/recommendations") {
    let body = {};
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (_) {
          return sendJson(res, 400, { error: "Invalid JSON body" });
        }
      }
    }

    const city = body.city || url.searchParams.get("city") || "Kolkata";
    const aqiLevel = body.aqiLevel || url.searchParams.get("aqiLevel") || "";
    const lifestyle = body.lifestyle || {};

    const aqiData = await fetchLiveAqi(city);
    const plan = await generateGeminiAdvice(aqiData, aqiLevel, lifestyle);
    return sendJson(res, 200, plan);
  }

  return sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Urban Air Quality Backend running on port ${PORT}`);
});
