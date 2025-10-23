# Secure Routes Kerala 🗺️

A web application that helps users find safer travel routes in Kerala by analyzing historical crime and accident data along with real-time weather conditions.

![Kerala Safe Route Prototype](https://raw.githubusercontent.com/ChandraSagarDev/secure-routes-kerala/master/docs/preview.png)

## 🌟 Features

- **Route Safety Analysis**: Compares multiple route options to find both the fastest and safest paths
- **Incident Heatmap**: Visualizes crime and accident hotspots across Kerala
- **Weather Integration**: Considers current weather conditions in safety calculations
- **Interactive Map**: Click-to-set waypoints or enter addresses manually
- **Detailed Statistics**: Shows distance, duration, safety scores, and nearby incidents for each route

## 🚀 Getting Started

### Prerequisites

- Modern web browser with JavaScript enabled
- API keys for:
  - OpenRouteService (for routing)
  - OpenWeatherMap (optional, for weather data)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/ChandraSagarDev/secure-routes-kerala.git
   cd secure-routes-kerala
   ```

2. Set up configuration:
   - Copy `config.template.js` to `config.js`
   - Add your API keys to `config.js`:
   ```javascript
   const CONFIG = {
     ORS_API_KEY: "YOUR_OPENROUTESERVICE_API_KEY",
     OWM_API_KEY: "YOUR_OPENWEATHERMAP_API_KEY",
     INCIDENT_RADIUS_METERS: 300,
     SAMPLE_SPACING_METERS: 200
   };
   ```

3. Generate sample data (optional):
   ```bash
   python generate_kerala_data.py
   ```
   This will create sample incident data in the `data/` directory.

4. Serve the application:
   - Use any local web server to serve the files
   - For Python: `python -m http.server 8000`
   - For Node.js: `npx serve`

5. Open in browser:
   - Navigate to `http://localhost:8000`

## 🔧 How It Works

1. **Data Sources**
   - Crime incidents from `kerala_crime_2022_2023.csv`
   - Accident records from `kerala_accidents_2022_2023.csv`
   - Real-time weather data from OpenWeatherMap
   - Routing via OpenRouteService

2. **Route Analysis**
   - Generates multiple route candidates
   - Samples points along each route
   - Counts nearby incidents within configured radius
   - Applies weather risk factors
   - Computes final safety scores

3. **Safety Score Calculation**
   - Based on incident proximity and severity
   - Weighted by distance from route
   - Modified by current weather conditions
   - Normalized to 0-1 scale

## 📚 API Dependencies

- [Leaflet](https://leafletjs.com/) - Interactive maps
- [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) - Heatmap visualization
- [PapaParse](https://www.papaparse.com/) - CSV parsing
- [OpenRouteService](https://openrouteservice.org/) - Route calculation
- [OpenWeatherMap](https://openweathermap.org/) - Weather data (optional)

## 📝 Data Format

The application expects CSV files with the following structures:

### Crime Data (`kerala_crime_2022_2023.csv`):
```csv
id,date,latitude,longitude,district,type,severity,description,source
```

### Accident Data (`kerala_accidents_2022_2023.csv`):
```csv
id,date,latitude,longitude,district,type,severity,vehicles_involved,fatalities,description,source
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Kerala Police Department for inspiration
- OpenStreetMap contributors
- All third-party library maintainers

## 📧 Contact

Chandra Sagar - [@ChandraSagarDev](https://github.com/ChandraSagarDev)

Project Link: [https://github.com/ChandraSagarDev/secure-routes-kerala](https://github.com/ChandraSagarDev/secure-routes-kerala)