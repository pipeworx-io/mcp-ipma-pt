# mcp-ipma-pt

IPMA Portugal MCP — weather, UV, sea state, and earthquakes from the

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `ipma_forecast` | Portugal weather forecast — official IPMA 5-day forecast for a Portuguese city: Lisbon, Porto, Faro, the Algarve, Madeira (Funchal), Azores (Ponta Delgada). Returns daily min/max temperature (°C), precipitation probability, weather description in English, and wind direction/strength. Example: ipma_forecast({ city: "Lisboa" }) |
| `ipma_uv_forecast` | UV index forecast for Portugal from IPMA — daily peak-hours ultraviolet index for a Portuguese city (Lisbon, Porto, Algarve, Madeira, Azores) for the next ~3 days, with risk level (Low to Extreme). Example: ipma_uv_forecast({ city: "Faro" }) |
| `ipma_sea_forecast` | Sea state forecast for the Portuguese coast from IPMA oceanography — significant wave height (m), wave period (s), wave direction, and sea surface temperature (°C) for 12 coastal zones on the mainland, Madeira, and Azores. Good for surf, sailing, and beach conditions. Example: ipma_sea_forecast({ city: "Sagres" }) |
| `ipma_seismic` | Portugal earthquakes — recent seismic events recorded by IPMA for mainland Portugal + Madeira or for the Azores archipelago. Returns time, magnitude, depth, epicenter region, coordinates, and felt intensity when reported. Covers roughly the last 30 days. Example: ipma_seismic({ area: "azores", min_magnitude: 2 }) |
| `ipma_locations` | List the Portuguese cities and islands IPMA publishes weather forecasts for — district capitals plus Madeira and Azores islands — with their globalIdLocal codes and coordinates region. Filter by name. Example: ipma_locations({ query: "faro" }) |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "ipma-pt": {
      "url": "https://gateway.pipeworx.io/ipma-pt/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Ipma Pt data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
