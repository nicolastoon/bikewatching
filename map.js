// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function renderTooltip(station) {
    const name = document.getElementById('name');
    const total_traffic = document.getElementById('total-traffic');
    const arrivals = document.getElementById('arrivals');
    const departures = document.getElementById('departures');

    if (Object.keys(station).length === 0) return;
  
    name.textContent = station.name;
    total_traffic.textContent = station.totalTraffic;
    arrivals.textContent = station.arrivals;
    departures.textContent = station.departures;
}

function updateTooltipVisibility(isVisible) {
    const tooltip = document.getElementById('tooltip');
    tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
    const tooltip = document.getElementById('tooltip');
    const offset = 20;
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${event.clientY - tooltip.offsetHeight - offset}px`;
}

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoibmljb2xhc3Rvb24iLCJhIjoiY21hcWJtd2k0MDdybjJrcTFyczdmcDF2aSJ9.VguzhBBxvwnLlD27LU8XCw';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/nicolastoon/cmaqctazb01dd01si99u91osr', // Map style
    center: [-71.09415, 42.36027], // [longitude, latitude]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18, // Maximum allowed zoom
});

map.on('load', async () => {
    map.addSource('boston_bikes', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addSource('cambridge_bikes', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_bikes',
        paint: {
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.4,
        },
    });

    map.addLayer({
        id: 'bike-lanes-2',
        type: 'line',
        source: 'cambridge_bikes',
        paint: {
            'line-color': 'green',
            'line-width': 3,        
            'line-opacity': 0.4      
        },
    });

    let jsonData;
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

        // Await JSON fetch
        jsonData = await d3.json(jsonurl);

        console.log('Loaded JSON Data:', jsonData); // Log to verify structure
    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }

    const svg = d3.select('#map').select('svg');
    //within the map.on('load')
    let trips = await d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            let startedMinutes = minutesSinceMidnight(trip.started_at);
            //This function returns how many minutes have passed since `00:00` (midnight).
            departuresByMinute[startedMinutes].push(trip);
            arrivalsByMinute[startedMinutes].push(trip)
            return trip;
        },
    );
    const stations = computeStationTraffic(jsonData.data.stations);

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 25]);

    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

    const circles = svg
        .selectAll('circle')
        .data(stations)
        .enter()
        .append('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic)) // Radius of the circle
        .attr('fill', 'steelblue') // Circle fill color
        .attr('stroke', 'white') // Circle border color
        .attr('stroke-width', 1) // Circle border thickness
        .attr('opacity', 0.6) // Circle opacity
        .attr('pointer-events', 'auto')
        .on('mouseover', (event, station) => {
            renderTooltip(station);
            updateTooltipVisibility(true);
            updateTooltipPosition(event);
        })
        .on('mouseout', () => {
            updateTooltipVisibility(false);
        })
        .style('--departure-ratio', (d) =>
            stationFlow(d.departures / d.totalTraffic),
        );

    console.log('tooltips loaded!');
    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
        circles
            .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
            .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends

    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

    function updateTimeDisplay() {
        const timeFilter = Number(timeSlider.value); // Get slider value

        if (timeFilter === -1) {
            selectedTime.textContent = ''; // Clear time display
            anyTimeLabel.style.display = 'block'; // Show "(any time)"
        } else {
            selectedTime.textContent = formatTime(timeFilter); // Display formatted time
            anyTimeLabel.style.display = 'none'; // Hide "(any time)"
        }

        // Call updateScatterPlot to reflect the changes on the map
        updateScatterPlot(timeFilter);
    }

    function updateScatterPlot(timeFilter) {
        // Recompute station traffic based on the filtered trips
        const filteredStations = computeStationTraffic(stations, timeFilter);

        timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

        // Update the scatterplot by adjusting the radius of circles
        circles
            .data(filteredStations)
            .join('circle') // Ensure the data is bound correctly
            .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
            .style('--departure-ratio', (d) =>
                stationFlow(d.departures / d.totalTraffic),
            );
    };
});

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, timeFilter = -1) {
    // Compute departures
    // Retrieve filtered trips efficiently
    const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
        (v) => v.length,
        (d) => d.start_station_id
    );

    const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
        (v) => v.length,
        (d) => d.end_station_id
    );

    // Update each station..
    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures
        return station;
    });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
        return tripsByMinute.flat(); // No filtering, return all trips
    }

    // Normalize both min and max minutes to the valid range [0, 1439]
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;

    // Handle time filtering across midnight
    if (minMinute > maxMinute) {
        let beforeMidnight = tripsByMinute.slice(minMinute);
        let afterMidnight = tripsByMinute.slice(0, maxMinute);
        return beforeMidnight.concat(afterMidnight).flat();
    } else {
        return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}