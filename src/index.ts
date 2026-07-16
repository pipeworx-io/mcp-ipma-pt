interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * IPMA Portugal MCP — weather, UV, sea state, and earthquakes from the
 * Instituto Português do Mar e da Atmosfera (api.ipma.pt/open-data, keyless).
 *
 * Tools:
 * - ipma_forecast: official 5-day weather forecast for a Portuguese city
 * - ipma_uv_forecast: UV index forecast per city (next ~3 days)
 * - ipma_sea_forecast: coastal sea state — wave height/period, sea temp
 * - ipma_seismic: recent earthquakes (mainland+Madeira or Azores networks)
 * - ipma_locations: list forecastable cities/islands with globalIdLocal
 *
 * IPMA is Portugal's national met/geophysics institute. City forecasts are
 * the official product, updated twice daily (~00h and ~12h UTC). Seismic
 * feeds cover roughly the last 30 days of events.
 */


const BASE = 'https://api.ipma.pt/open-data';

// ---------------------------------------------------------------------------
// Forecastable locations (from /distrits-islands.json — stable official list).
// region: mainland | madeira | azores.
const LOCATIONS: Array<{ id: number; name: string; region: string; island?: string }> = [
  { id: 1010500, name: 'Aveiro', region: 'mainland' },
  { id: 1020500, name: 'Beja', region: 'mainland' },
  { id: 1030300, name: 'Braga', region: 'mainland' },
  { id: 1030800, name: 'Guimarães', region: 'mainland' },
  { id: 1040200, name: 'Bragança', region: 'mainland' },
  { id: 1050200, name: 'Castelo Branco', region: 'mainland' },
  { id: 1060300, name: 'Coimbra', region: 'mainland' },
  { id: 1070500, name: 'Évora', region: 'mainland' },
  { id: 1080500, name: 'Faro', region: 'mainland' },
  { id: 1081505, name: 'Sagres', region: 'mainland' },
  { id: 1081100, name: 'Portimão', region: 'mainland' },
  { id: 1080800, name: 'Loulé', region: 'mainland' },
  { id: 1090700, name: 'Guarda', region: 'mainland' },
  { id: 1090821, name: 'Penhas Douradas', region: 'mainland' },
  { id: 1100900, name: 'Leiria', region: 'mainland' },
  { id: 1110600, name: 'Lisboa', region: 'mainland' },
  { id: 1121400, name: 'Portalegre', region: 'mainland' },
  { id: 1131200, name: 'Porto', region: 'mainland' },
  { id: 1141600, name: 'Santarém', region: 'mainland' },
  { id: 1151200, name: 'Setúbal', region: 'mainland' },
  { id: 1151300, name: 'Sines', region: 'mainland' },
  { id: 1160900, name: 'Viana do Castelo', region: 'mainland' },
  { id: 1171400, name: 'Vila Real', region: 'mainland' },
  { id: 1182300, name: 'Viseu', region: 'mainland' },
  { id: 2310300, name: 'Funchal', region: 'madeira', island: 'Madeira' },
  { id: 2320100, name: 'Porto Santo', region: 'madeira', island: 'Porto Santo' },
  { id: 3410100, name: 'Vila do Porto', region: 'azores', island: 'Santa Maria' },
  { id: 3420300, name: 'Ponta Delgada', region: 'azores', island: 'São Miguel' },
  { id: 3430100, name: 'Angra do Heroísmo', region: 'azores', island: 'Terceira' },
  { id: 3440100, name: 'Santa Cruz da Graciosa', region: 'azores', island: 'Graciosa' },
  { id: 3450200, name: 'Velas', region: 'azores', island: 'São Jorge' },
  { id: 3460200, name: 'Madalena', region: 'azores', island: 'Pico' },
  { id: 3470100, name: 'Horta', region: 'azores', island: 'Faial' },
  { id: 3480200, name: 'Santa Cruz das Flores', region: 'azores', island: 'Flores' },
  { id: 3490100, name: 'Vila do Corvo', region: 'azores', island: 'Corvo' },
];

// English/common aliases → canonical IPMA local name.
const CITY_ALIASES: Record<string, string> = {
  lisbon: 'Lisboa',
  oporto: 'Porto',
  madeira: 'Funchal',
  algarve: 'Faro',
  'sao miguel': 'Ponta Delgada',
  azores: 'Ponta Delgada',
  acores: 'Ponta Delgada',
  terceira: 'Angra do Heroísmo',
  faial: 'Horta',
  pico: 'Madalena',
  'sao jorge': 'Velas',
  graciosa: 'Santa Cruz da Graciosa',
  flores: 'Santa Cruz das Flores',
  corvo: 'Vila do Corvo',
  'santa maria': 'Vila do Porto',
};

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function findLocation(city: string): { id: number; name: string; region: string; island?: string } | null {
  const q = norm(city);
  if (!q) return null;
  const aliased = CITY_ALIASES[q];
  const target = aliased ? norm(aliased) : q;
  // Exact match first, then substring either way.
  const exact = LOCATIONS.find((l) => norm(l.name) === target);
  if (exact) return exact;
  return (
    LOCATIONS.find((l) => norm(l.name).includes(target) || target.includes(norm(l.name))) ??
    LOCATIONS.find((l) => (l.island ? norm(l.island) === target : false)) ??
    null
  );
}

// idWeatherType → English description (from /weather-type-classe.json, stable).
const WEATHER_TYPES: Record<number, string> = {
  0: 'No information',
  1: 'Clear sky',
  2: 'Partly cloudy',
  3: 'Sunny intervals',
  4: 'Cloudy',
  5: 'Cloudy (high cloud)',
  6: 'Showers/rain',
  7: 'Light showers/rain',
  8: 'Heavy showers/rain',
  9: 'Rain/showers',
  10: 'Light rain',
  11: 'Heavy rain/showers',
  12: 'Intermittent rain',
  13: 'Intermittent light rain',
  14: 'Intermittent heavy rain',
  15: 'Drizzle',
  16: 'Mist',
  17: 'Fog',
  18: 'Snow',
  19: 'Thunderstorms',
  20: 'Showers and thunderstorms',
  21: 'Hail',
  22: 'Frost',
  23: 'Rain and thunderstorms',
  24: 'Convective clouds',
  25: 'Partly cloudy',
  26: 'Fog',
  27: 'Cloudy',
  28: 'Snow showers',
  29: 'Rain and snow',
  30: 'Rain and snow',
};

// classWindSpeed → English description (from /wind-speed-daily-classe.json).
const WIND_CLASSES: Record<number, string> = {
  1: 'Weak',
  2: 'Moderate',
  3: 'Strong',
  4: 'Very strong',
};

// Sea-forecast coastal zones (from /forecast/oceanography/daily — fixed set of
// 12 globalIdLocal codes, suffix 26; hand-mapped to the nearest named coast).
const SEA_ZONES: Record<number, { name: string; region: string }> = {
  1160926: { name: 'Viana do Castelo', region: 'mainland' },
  1130826: { name: 'Porto / Leixões', region: 'mainland' },
  1060526: { name: 'Figueira da Foz', region: 'mainland' },
  1111026: { name: 'Lisboa / Cascais', region: 'mainland' },
  1151326: { name: 'Sines', region: 'mainland' },
  1081526: { name: 'Sagres', region: 'mainland' },
  1080526: { name: 'Faro', region: 'mainland' },
  2310326: { name: 'Funchal (Madeira)', region: 'madeira' },
  2320126: { name: 'Porto Santo', region: 'madeira' },
  3420226: { name: 'Ponta Delgada (São Miguel)', region: 'azores' },
  3470126: { name: 'Horta (Faial)', region: 'azores' },
  3480226: { name: 'Santa Cruz das Flores', region: 'azores' },
};

function uvLevel(iuv: number): string {
  if (iuv >= 11) return 'Extreme';
  if (iuv >= 8) return 'Very high';
  if (iuv >= 6) return 'High';
  if (iuv >= 3) return 'Moderate';
  return 'Low';
}

const tools: McpToolExport['tools'] = [
  {
    name: 'ipma_forecast',
    description:
      'Portugal weather forecast — official IPMA 5-day forecast for a Portuguese city: Lisbon, Porto, Faro, the Algarve, Madeira (Funchal), Azores (Ponta Delgada). Returns daily min/max temperature (°C), precipitation probability, weather description in English, and wind direction/strength. Example: ipma_forecast({ city: "Lisboa" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          description:
            'Portuguese city or island, e.g. "Lisboa", "Lisbon", "Porto", "Faro", "Funchal", "Ponta Delgada". Accent-insensitive; use ipma_locations to browse all 35.',
        },
      },
      required: ['city'],
    },
  },
  {
    name: 'ipma_uv_forecast',
    description:
      'UV index forecast for Portugal from IPMA — daily peak-hours ultraviolet index for a Portuguese city (Lisbon, Porto, Algarve, Madeira, Azores) for the next ~3 days, with risk level (Low to Extreme). Example: ipma_uv_forecast({ city: "Faro" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          description: 'Portuguese city, e.g. "Lisboa", "Porto", "Faro", "Funchal". Accent-insensitive.',
        },
      },
      required: ['city'],
    },
  },
  {
    name: 'ipma_sea_forecast',
    description:
      'Sea state forecast for the Portuguese coast from IPMA oceanography — significant wave height (m), wave period (s), wave direction, and sea surface temperature (°C) for 12 coastal zones on the mainland, Madeira, and Azores. Good for surf, sailing, and beach conditions. Example: ipma_sea_forecast({ city: "Sagres" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          description:
            'Optional coastal zone filter, e.g. "Sagres", "Lisboa", "Porto", "Funchal", "Ponta Delgada". Omit for all 12 zones.',
        },
        day: {
          type: 'number',
          description: 'Forecast day: 0 = today (default), 1 = tomorrow, 2 = day after.',
        },
      },
      required: [],
    },
  },
  {
    name: 'ipma_seismic',
    description:
      'Portugal earthquakes — recent seismic events recorded by IPMA for mainland Portugal + Madeira or for the Azores archipelago. Returns time, magnitude, depth, epicenter region, coordinates, and felt intensity when reported. Covers roughly the last 30 days. Example: ipma_seismic({ area: "azores", min_magnitude: 2 })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        area: {
          type: 'string',
          description: '"mainland" (mainland Portugal + Madeira, default) or "azores".',
        },
        min_magnitude: {
          type: 'number',
          description: 'Minimum magnitude filter, e.g. 2.0. Events without a computed magnitude are excluded when set.',
        },
        days: {
          type: 'number',
          description: 'How many days back to include, 1-30 (default 7).',
        },
      },
      required: [],
    },
  },
  {
    name: 'ipma_locations',
    description:
      'List the Portuguese cities and islands IPMA publishes weather forecasts for — district capitals plus Madeira and Azores islands — with their globalIdLocal codes and coordinates region. Filter by name. Example: ipma_locations({ query: "faro" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Optional name filter (accent-insensitive substring), e.g. "faro", "santa".',
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------

async function ipmaFetch(path: string): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'pipeworx-gateway/1.0 (+https://pipeworx.io)' },
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new Error('upstream_down: IPMA (api.ipma.pt) did not respond within 8s.');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const prefix = res.status >= 500 ? 'upstream_down: ' : '';
    throw new Error(`${prefix}IPMA error: HTTP ${res.status} on ${path}`);
  }
  return res.json();
}

function requireCity(args: Record<string, unknown>, tool: string) {
  const city = (args.city as string | undefined) ?? (args.location as string | undefined) ?? '';
  const loc = findLocation(city);
  if (!loc) {
    throw new Error(
      `${tool}: no IPMA location matches "${city}". IPMA covers district capitals and islands — try "Lisboa", "Porto", "Faro", "Funchal", "Ponta Delgada", or call ipma_locations({}) for the full list of 35.`,
    );
  }
  return loc;
}

async function getForecast(args: Record<string, unknown>) {
  const loc = requireCity(args, 'ipma_forecast');
  const data = (await ipmaFetch(`/forecast/meteorology/cities/daily/${loc.id}.json`)) as {
    data: Array<{
      forecastDate: string;
      tMin: string;
      tMax: string;
      precipitaProb: string;
      idWeatherType: number;
      predWindDir: string;
      classWindSpeed: number;
      latitude: string;
      longitude: string;
    }>;
    dataUpdate?: string;
  };

  return {
    location: loc.name,
    region: loc.region,
    global_id_local: loc.id,
    updated: data.dataUpdate ?? null,
    forecast: (data.data ?? []).map((d) => ({
      date: d.forecastDate,
      t_min_c: parseFloat(d.tMin),
      t_max_c: parseFloat(d.tMax),
      precipitation_prob_pct: parseFloat(d.precipitaProb),
      weather: WEATHER_TYPES[d.idWeatherType] ?? `type ${d.idWeatherType}`,
      wind_direction: d.predWindDir,
      wind: WIND_CLASSES[d.classWindSpeed] ?? null,
    })),
    note: 'Official IPMA city forecast, updated twice daily (~00h and ~12h UTC). Temperatures in °C.',
  };
}

async function getUvForecast(args: Record<string, unknown>) {
  const loc = requireCity(args, 'ipma_uv_forecast');
  const rows = (await ipmaFetch('/forecast/meteorology/uv/uv.json')) as Array<{
    globalIdLocal: number;
    data: string;
    iUv: string;
    intervaloHora: string;
  }>;

  // Exact id match first; some spots (e.g. Sagres) publish under a sibling
  // concelho code — fall back to matching on the 5-digit district+concelho
  // prefix, then the 3-digit district prefix.
  let matched = rows.filter((r) => r.globalIdLocal === loc.id);
  if (matched.length === 0) {
    const p5 = Math.floor(loc.id / 100);
    matched = rows.filter((r) => Math.floor(r.globalIdLocal / 100) === p5);
  }
  if (matched.length === 0) {
    const p3 = Math.floor(loc.id / 10000);
    matched = rows.filter((r) => Math.floor(r.globalIdLocal / 10000) === p3);
  }
  if (matched.length === 0) {
    throw new Error(
      `ipma_uv_forecast: IPMA publishes UV for district capitals; no UV rows found near "${loc.name}". Try the district capital (e.g. "Faro" for the Algarve).`,
    );
  }

  return {
    location: loc.name,
    region: loc.region,
    uv_forecast: matched
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((r) => {
        const iuv = parseFloat(r.iUv);
        return { date: r.data, peak_hours: r.intervaloHora, uv_index: iuv, level: uvLevel(iuv) };
      }),
    note: 'IPMA UV index forecast for peak sun hours. Levels: Low <3, Moderate 3-5, High 6-7, Very high 8-10, Extreme 11+.',
  };
}

async function getSeaForecast(args: Record<string, unknown>) {
  const dayRaw = Number(args.day ?? 0);
  const day = Number.isFinite(dayRaw) ? Math.min(Math.max(Math.trunc(dayRaw), 0), 2) : 0;
  const data = (await ipmaFetch(`/forecast/oceanography/daily/hp-daily-sea-forecast-day${day}.json`)) as {
    forecastDate: string;
    data: Array<{
      globalIdLocal: number;
      waveHighMin: string;
      waveHighMax: string;
      wavePeriodMin: string;
      wavePeriodMax: string;
      predWaveDir: string;
      sstMin: string;
      sstMax: string;
      totalSeaMin: number;
      totalSeaMax: number;
      latitude: string;
      longitude: string;
    }>;
  };

  let zones = (data.data ?? []).map((z) => ({
    zone: SEA_ZONES[z.globalIdLocal]?.name ?? `zone ${z.globalIdLocal}`,
    region: SEA_ZONES[z.globalIdLocal]?.region ?? null,
    latitude: parseFloat(z.latitude),
    longitude: parseFloat(z.longitude),
    wave_height_m: { min: parseFloat(z.waveHighMin), max: parseFloat(z.waveHighMax) },
    wave_period_s: { min: parseFloat(z.wavePeriodMin), max: parseFloat(z.wavePeriodMax) },
    wave_direction: z.predWaveDir,
    total_sea_m: { min: z.totalSeaMin, max: z.totalSeaMax },
    sea_surface_temp_c: { min: parseFloat(z.sstMin), max: parseFloat(z.sstMax) },
  }));

  const city = (args.city as string | undefined)?.trim();
  if (city) {
    const q = norm(city);
    const target = CITY_ALIASES[q] ? norm(CITY_ALIASES[q]) : q;
    const filtered = zones.filter((z) => norm(z.zone).includes(target) || target.includes(norm(z.zone)));
    if (filtered.length === 0) {
      throw new Error(
        `ipma_sea_forecast: no coastal zone matches "${city}". Available zones: ${Object.values(SEA_ZONES)
          .map((z) => z.name)
          .join(', ')}.`,
      );
    }
    zones = filtered;
  }

  return {
    forecast_date: data.forecastDate,
    day_offset: day,
    zones,
    note: 'IPMA oceanography daily forecast (significant wave height/period, sea surface temperature). Days 0-2 available.',
  };
}

const SEISMIC_AREAS: Record<string, number> = {
  mainland: 7,
  continent: 7,
  continente: 7,
  portugal: 7,
  madeira: 7,
  azores: 3,
  acores: 3,
};

async function getSeismic(args: Record<string, unknown>) {
  const areaRaw = norm((args.area as string | undefined) ?? 'mainland');
  const idArea = SEISMIC_AREAS[areaRaw];
  if (!idArea) {
    throw new Error(`ipma_seismic: unknown area "${args.area}". Use "mainland" (mainland Portugal + Madeira) or "azores".`);
  }
  const daysRaw = Number(args.days ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 30) : 7;
  const minMag = args.min_magnitude != null ? Number(args.min_magnitude) : null;

  const data = (await ipmaFetch(`/observation/seismic/${idArea}.json`)) as {
    updateDate?: string;
    lastSismicActivityDate?: string;
    data: Array<{
      time: string;
      magnitud: string;
      magType: string;
      depth: number;
      obsRegion: string;
      lat: string;
      lon: string;
      sensed: string | null;
      degree: string | null;
      local: string | null;
    }>;
  };

  const cutoff = Date.now() - days * 86400_000;
  const events = (data.data ?? [])
    .map((e) => {
      const mag = parseFloat(e.magnitud);
      return {
        time: e.time,
        magnitude: Number.isFinite(mag) && mag > -90 ? mag : null, // IPMA uses -99.0 for "not yet computed"
        mag_type: e.magType || null,
        depth_km: e.depth,
        region: e.obsRegion,
        latitude: parseFloat(e.lat),
        longitude: parseFloat(e.lon),
        felt: e.sensed ?? null,
        felt_intensity: e.degree ?? null,
      };
    })
    .filter((e) => {
      const ts = Date.parse(e.time);
      if (!Number.isFinite(ts) || ts < cutoff) return false;
      if (minMag != null) return e.magnitude != null && e.magnitude >= minMag;
      return true;
    })
    .sort((a, b) => b.time.localeCompare(a.time));

  return {
    area: idArea === 3 ? 'Azores' : 'Mainland Portugal + Madeira',
    id_area: idArea,
    days_back: days,
    updated: data.updateDate ?? null,
    last_activity: data.lastSismicActivityDate ?? null,
    count: events.length,
    events: events.slice(0, 50),
    note: 'IPMA seismic network. magnitude null = event recorded, magnitude not yet computed by an analyst.',
  };
}

function listLocations(args: Record<string, unknown>) {
  const q = (args.query as string | undefined)?.trim();
  let list = LOCATIONS;
  if (q) {
    const target = norm(q);
    list = LOCATIONS.filter(
      (l) => norm(l.name).includes(target) || (l.island ? norm(l.island).includes(target) : false),
    );
  }
  return {
    count: list.length,
    locations: list.map((l) => ({
      name: l.name,
      global_id_local: l.id,
      region: l.region,
      ...(l.island ? { island: l.island } : {}),
    })),
    note: 'IPMA forecast locations: mainland district capitals + notable spots, Madeira, and all nine Azores islands.',
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'ipma_forecast':
      return getForecast(args);
    case 'ipma_uv_forecast':
      return getUvForecast(args);
    case 'ipma_sea_forecast':
      return getSeaForecast(args);
    case 'ipma_seismic':
      return getSeismic(args);
    case 'ipma_locations':
      return listLocations(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
