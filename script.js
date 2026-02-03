// Fuel Consumption Calculator
// Based on the model: y = 0.000124176621498486*(x*x) - 0.00391529744030522*x + 0.104802913006673
// where y = consumption in mt/h, x = RPM
// Weather correction: yc = y * W (W = 0.5 to 1.5)
// ROB = HFO_start - yc * T (cumulative)

class FuelCalculator {
    constructor() {
        this.map = null;
        this.activeSegmentIndex = null;
        this.segmentData = []; // Array of {points: [], lines: []} for each segment
        this.modelChart = null;
        this.historicalChart = null;
        this.historicalData = [];
        this.init();
    }

    init() {
        this.initMap();
        this.initEventListeners();
        this.addInitialSegment();
        this.loadHistoricalData();
    }

    initMap() {
        this.map = L.map('map').setView([50.0, 0.0], 3); // Default view

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        this.map.on('click', (e) => {
            if (this.activeSegmentIndex !== null) {
                this.addRoutePoint(e.latlng);
            }
        });
    }

    addRoutePoint(latlng) {
        if (this.activeSegmentIndex === null) return;

        const marker = L.marker(latlng).addTo(this.map);
        const segmentIndex = this.activeSegmentIndex;

        // Make marker clickable to remove it
        marker.on('click', () => {
            this.removeRoutePoint(marker, segmentIndex);
        });

        // Add popup to indicate clickability
        marker.bindPopup(`Segment ${segmentIndex + 1} waypoint - Click to remove`);

        // Ensure segment data exists
        if (!this.segmentData[segmentIndex]) {
            this.segmentData[segmentIndex] = { points: [], lines: [] };
        }

        this.segmentData[segmentIndex].points.push({ latlng, marker });
        this.updateSegmentRoute(segmentIndex);
    }

    removeRoutePoint(markerToRemove, segmentIndex) {
        // Only allow removal if this segment is active
        if (this.activeSegmentIndex !== segmentIndex) return;

        const segmentData = this.segmentData[segmentIndex];
        if (!segmentData) return;

        // Find the point
        const index = segmentData.points.findIndex(point => point.marker === markerToRemove);
        if (index !== -1) {
            // Don't allow removal of first point if it's connected to previous segment
            if (index === 0 && segmentIndex > 0) {
                const prevSegment = this.segmentData[segmentIndex - 1];
                if (prevSegment && prevSegment.points.length > 0) {
                    alert(`Cannot remove first waypoint - it connects to Segment ${segmentIndex}`);
                    return;
                }
            }

            // Don't allow removal of last point if there's a next segment using it
            if (index === segmentData.points.length - 1 && segmentIndex < this.segmentData.length - 1) {
                const nextSegment = this.segmentData[segmentIndex + 1];
                if (nextSegment && nextSegment.points.length > 0) {
                    alert(`Cannot remove last waypoint - it connects to Segment ${segmentIndex + 2}`);
                    return;
                }
            }

            // Remove marker from map
            this.map.removeLayer(markerToRemove);
            // Remove from array
            segmentData.points.splice(index, 1);
            // Update route
            this.updateSegmentRoute(segmentIndex);
        }
    }

    updateSegmentRoute(segmentIndex) {
        const segmentData = this.segmentData[segmentIndex];
        if (!segmentData) return;

        // Clear existing lines for this segment
        segmentData.lines.forEach(line => this.map.removeLayer(line));
        segmentData.lines = [];

        const points = segmentData.points;

        // Add new lines between consecutive points
        for (let i = 0; i < points.length - 1; i++) {
            const line = L.polyline([
                points[i].latlng,
                points[i + 1].latlng
            ], { color: 'blue' }).addTo(this.map);
            segmentData.lines.push(line);
        }

        // Calculate total distance for this segment
        this.updateSegmentDistance(segmentIndex);
    }

    updateSegmentDistance(segmentIndex) {
        const segmentData = this.segmentData[segmentIndex];
        if (!segmentData || !segmentData.points) return;

        const points = segmentData.points;
        let totalDistance = 0;

        // Sum distances between consecutive points
        for (let i = 0; i < points.length - 1; i++) {
            const dist = this.calculateDistance(
                points[i].latlng,
                points[i + 1].latlng
            );
            totalDistance += dist;
        }

        // Update the distance input for this segment
        const segmentElements = document.querySelectorAll('.segment');
        if (segmentElements[segmentIndex]) {
            const distanceInput = segmentElements[segmentIndex].querySelector('.distance-nm');
            distanceInput.value = totalDistance > 0 ? totalDistance.toFixed(2) : '';
        }

        // Auto-calculate fuel consumption after distance update
        this.calculateFuelConsumption();
    }

    calculateDistance(latlng1, latlng2) {
        // Haversine formula for distance between two points on Earth
        const R = 6371; // Earth's radius in km
        const dLat = (latlng2.lat - latlng1.lat) * Math.PI / 180;
        const dLon = (latlng2.lng - latlng1.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(latlng1.lat * Math.PI / 180) * Math.cos(latlng2.lat * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distanceKm = R * c;
        // Convert to nautical miles (1 nm = 1.852 km)
        return distanceKm / 1.852;
    }

    calculateConsumption(rpm, weatherFactor) {
        if (!rpm || rpm <= 0) return 0;

        const x = rpm;
        const y = 0.000124176621498486 * (x * x) - 0.00391529744030522 * x + 0.104802913006673;
        const yc = y * weatherFactor;
        return yc;
    }

    calculateTime(distance, speed) {
        if (!speed || speed <= 0) return 0;
        return distance / speed; // time = distance / speed
    }

    calculateSpeed(distance, time) {
        if (!time || time <= 0) return 0;
        return distance / time; // speed = distance / time
    }

    initEventListeners() {
        document.getElementById('add-segment').addEventListener('click', () => {
            this.addSegment();
        });

        // Event delegation for segment clicks and remove buttons
        document.getElementById('segments').addEventListener('click', (e) => {
            const segment = e.target.closest('.segment');
            if (!segment) return;

            if (e.target.classList.contains('remove-segment')) {
                e.stopPropagation(); // Prevent triggering other events
                const index = Array.from(document.querySelectorAll('.segment')).indexOf(segment);
                this.removeSegment(index);
            } else if (e.target.classList.contains('toggle-icon')) {
                e.stopPropagation(); // Prevent triggering other events
                // Toggle collapse/expand only when clicking the arrow icon
                this.toggleSegment(segment);
            }
        });

        // Event delegation for segment double-click to activate/deactivate
        document.getElementById('segments').addEventListener('dblclick', (e) => {
            const segment = e.target.closest('.segment');
            if (!segment) return;

            // Don't activate if clicking on input fields, buttons, or interactive elements
            if (e.target.tagName === 'INPUT' || 
                e.target.tagName === 'BUTTON' || 
                e.target.classList.contains('toggle-icon') ||
                e.target.classList.contains('remove-segment')) return;

            const index = Array.from(document.querySelectorAll('.segment')).indexOf(segment);
            
            // If clicking active segment, deactivate it
            if (this.activeSegmentIndex === index) {
                this.deactivateSegment();
            } else {
                // Otherwise activate this segment
                this.setActiveSegment(index);
            }
        });

        // Event delegation for time/speed input changes
        document.getElementById('segments').addEventListener('input', (e) => {
            const segment = e.target.closest('.segment');
            if (!segment) return;

            // Update weather factor display
            if (e.target.classList.contains('weather-factor')) {
                const valueDisplay = segment.querySelector('.weather-value');
                if (valueDisplay) {
                    valueDisplay.textContent = parseFloat(e.target.value).toFixed(2);
                }
            }

            const distanceInput = segment.querySelector('.distance-nm');
            const timeInput = segment.querySelector('.time-h');
            const speedInput = segment.querySelector('.speed-kn');

            const distance = parseFloat(distanceInput.value) || 0;

            // If time was changed, calculate speed
            if (e.target.classList.contains('time-h')) {
                const time = parseFloat(timeInput.value) || 0;
                if (distance > 0 && time > 0) {
                    const speed = this.calculateSpeed(distance, time);
                    speedInput.value = speed.toFixed(2);
                }
            }

            // If speed was changed, calculate time
            if (e.target.classList.contains('speed-kn')) {
                const speed = parseFloat(speedInput.value) || 0;
                if (distance > 0 && speed > 0) {
                    const time = this.calculateTime(distance, speed);
                    timeInput.value = time.toFixed(2);
                }
            }

            // Auto-calculate fuel consumption after any input change
            this.calculateFuelConsumption();
            
            // Update charts if they're visible
            this.updateChartsIfVisible();
        });

        // Auto-calculate when HFO Start changes
        document.getElementById('hfo-start').addEventListener('input', () => {
            this.calculateFuelConsumption();
        });

        // Data Chart button
        document.getElementById('data-chart-btn').addEventListener('click', () => {
            this.toggleDataChart();
        });

        // Back to Map button
        document.getElementById('back-to-map-btn').addEventListener('click', () => {
            this.showMap();
        });
    }

    setActiveSegment(index) {
        // Deactivate previous segment
        const segments = document.querySelectorAll('.segment');
        segments.forEach(seg => seg.classList.remove('active'));

        // Activate new segment
        this.activeSegmentIndex = index;
        segments[index].classList.add('active');

        // If this segment has no points and there's a previous segment with points,
        // use the last point of the previous segment as the first point
        if (index > 0 && this.segmentData[index] && this.segmentData[index].points.length === 0) {
            const prevSegment = this.segmentData[index - 1];
            if (prevSegment && prevSegment.points.length > 0) {
                const lastPoint = prevSegment.points[prevSegment.points.length - 1];
                // Add this point to the current segment (create new marker at same location)
                const marker = L.marker(lastPoint.latlng).addTo(this.map);
                marker.on('click', () => {
                    this.removeRoutePoint(marker, index);
                });
                marker.bindPopup(`Segment ${index + 1} waypoint - Click to remove`);
                
                this.segmentData[index].points.push({ latlng: lastPoint.latlng, marker });
                this.updateSegmentRoute(index);
            }
        }
    }

    deactivateSegment() {
        // Remove active class from all segments
        const segments = document.querySelectorAll('.segment');
        segments.forEach(seg => seg.classList.remove('active'));
        
        // Set active index to null
        this.activeSegmentIndex = null;
    }

    toggleSegment(segment) {
        segment.classList.toggle('collapsed');
        const icon = segment.querySelector('.toggle-icon');
        if (icon) {
            icon.textContent = segment.classList.contains('collapsed') ? '▶' : '▼';
        }
    }

    showDataChart() {
        document.getElementById('map').style.display = 'none';
        document.getElementById('data-chart-page').style.display = 'flex';
        document.getElementById('data-chart-btn').textContent = 'Back to Map';
        
        // Render charts when showing data chart page
        this.renderCharts();
    }

    showMap() {
        document.getElementById('map').style.display = 'block';
        document.getElementById('data-chart-page').style.display = 'none';
        document.getElementById('data-chart-btn').textContent = 'Data Chart';
    }

    toggleDataChart() {
        const dataChartPage = document.getElementById('data-chart-page');
        if (dataChartPage.style.display === 'none' || !dataChartPage.style.display) {
            this.showDataChart();
        } else {
            this.showMap();
        }
    }

    updateChartsIfVisible() {
        const dataChartPage = document.getElementById('data-chart-page');
        if (dataChartPage && dataChartPage.style.display === 'flex') {
            this.renderCharts();
        }
    }

    renderCharts() {
        // Save current scroll position
        const chartPage = document.getElementById('data-chart-page');
        const scrollPosition = chartPage.scrollTop;
        
        this.renderModelChart();
        this.renderHistoricalChart();
        
        // Restore scroll position after charts render
        requestAnimationFrame(() => {
            chartPage.scrollTop = scrollPosition;
        });
    }

    renderModelChart() {
        const ctx = document.getElementById('model-chart');
        
        // Destroy existing chart if it exists
        if (this.modelChart) {
            this.modelChart.destroy();
        }

        // Generate model consumption data from 45 to 124 RPM
        const modelData = [];
        for (let rpm = 45; rpm <= 124; rpm++) {
            const consumption = this.calculateConsumption(rpm, 1.0); // Weather factor = 1.0 for model
            modelData.push({ x: rpm, y: consumption });
        }

        // Get current working points from segments
        const workingPoints = this.getCurrentWorkingPoints();

        this.modelChart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Model Consumption',
                        data: modelData,
                        borderColor: 'blue',
                        backgroundColor: 'blue',
                        showLine: true,
                        pointRadius: 0,
                        borderWidth: 2,
                        order: 2
                    },
                    {
                        label: 'Current Working Points',
                        data: workingPoints,
                        backgroundColor: 'red',
                        pointRadius: 7.5,
                        pointHoverRadius: 10.5,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 2,
                scales: {
                    x: {
                        type: 'linear',
                        min: 30,
                        max: 130,
                        ticks: {
                            stepSize: 10
                        },
                        title: {
                            display: true,
                            text: 'RPM'
                        }
                    },
                    y: {
                        min: 0,
                        max: 2,
                        ticks: {
                            stepSize: 0.1
                        },
                        title: {
                            display: true,
                            text: 'Consumption (mt/h)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `RPM: ${context.parsed.x}, Consumption: ${context.parsed.y.toFixed(3)} mt/h`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderHistoricalChart() {
        const ctx = document.getElementById('historical-chart');
        
        // Destroy existing chart if it exists
        if (this.historicalChart) {
            this.historicalChart.destroy();
        }

        // Get current working points from segments (with corrected consumption)
        const workingPoints = this.getCurrentWorkingPointsCorrected();

        this.historicalChart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Historical Data',
                        data: this.historicalData,
                        backgroundColor: 'blue',
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        order: 2
                    },
                    {
                        label: 'Current Working Points',
                        data: workingPoints,
                        backgroundColor: 'red',
                        pointRadius: 7.5,
                        pointHoverRadius: 10.5,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 2,
                scales: {
                    x: {
                        type: 'linear',
                        min: 30,
                        max: 140,
                        ticks: {
                            stepSize: 10
                        },
                        title: {
                            display: true,
                            text: 'RPM'
                        }
                    },
                    y: {
                        min: 0,
                        max: 2.5,
                        ticks: {
                            stepSize: 0.1
                        },
                        title: {
                            display: true,
                            text: 'Consumption (mt/h)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `RPM: ${context.parsed.x}, Consumption: ${context.parsed.y.toFixed(3)} mt/h`;
                            }
                        }
                    }
                }
            }
        });
    }

    getCurrentWorkingPoints() {
        // Get RPM and corrected consumption (with weather factor) from segments
        const points = [];
        const segments = document.querySelectorAll('.segment');
        
        segments.forEach(segment => {
            const rpm = parseFloat(segment.querySelector('.rpm').value) || 0;
            const weatherFactor = parseFloat(segment.querySelector('.weather-factor').value) || 1.0;
            if (rpm > 0) {
                const consumption = this.calculateConsumption(rpm, weatherFactor);
                points.push({ x: rpm, y: consumption });
            }
        });
        
        return points;
    }

    getCurrentWorkingPointsCorrected() {
        // Get RPM and corrected consumption (with weather factor) from segments
        const points = [];
        const segments = document.querySelectorAll('.segment');
        
        segments.forEach(segment => {
            const rpm = parseFloat(segment.querySelector('.rpm').value) || 0;
            const weatherFactor = parseFloat(segment.querySelector('.weather-factor').value) || 1.0;
            if (rpm > 0) {
                const consumption = this.calculateConsumption(rpm, weatherFactor);
                points.push({ x: rpm, y: consumption });
            }
        });
        
        return points;
    }

    async loadHistoricalData() {
        try {
            const response = await fetch('user_data.xlsx');
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const worksheet = workbook.Sheets['data'];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            // Extract columns L and M (indices 11 and 12), starting from row 2 (index 1)
            this.historicalData = [];
            for (let i = 1; i < data.length; i++) {
                const rpm = data[i][11]; // Column L
                const consumption = data[i][12]; // Column M
                
                if (rpm != null && consumption != null && !isNaN(rpm) && !isNaN(consumption)) {
                    this.historicalData.push({ x: parseFloat(rpm), y: parseFloat(consumption) });
                }
            }
        } catch (error) {
            console.warn('Could not load historical data:', error);
            this.historicalData = [];
        }
    }

    addInitialSegment() {
        // Initial segment is already in HTML
        this.updateSegmentIndices();
        // Initialize first segment data
        this.segmentData[0] = { points: [], lines: [] };
        // Don't auto-activate - user must double-click to activate
    }

    addSegment() {
        const segmentsContainer = document.getElementById('segments');
        const segmentCount = document.querySelectorAll('.segment').length;
        const newSegment = document.createElement('div');
        newSegment.className = 'segment';
        newSegment.innerHTML = `
            <h3 class="segment-header">Segment ${segmentCount + 1} <span class="toggle-icon">▼</span></h3>
            <div class="segment-content">
                <div class="form-group">
                    <label>Distance (nm):</label>
                    <input type="number" class="distance-nm" step="0.01" placeholder="Enter distance or use map">
                </div>
                <div class="form-group">
                    <label>RPM:</label>
                    <input type="number" class="rpm" placeholder="Engine RPM">
                </div>
                <div class="form-group">
                    <label>Weather Factor:</label>
                    <div class="weather-slider-container">
                        <div class="weather-labels">
                            <span>Good</span>
                            <span>Model</span>
                            <span>Bad</span>
                        </div>
                        <input type="range" class="weather-factor" min="0.5" max="1.5" step="0.01" value="1.0">
                        <div class="weather-value">1.00</div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Time (h):</label>
                    <input type="number" class="time-h" step="0.01" placeholder="Time or auto-calculate">
                </div>
                <div class="form-group">
                    <label>Speed (kn):</label>
                    <input type="number" class="speed-kn" step="0.01" placeholder="Speed for time calc">
                </div>
                <button class="remove-segment">Remove</button>
            </div>
        `;
        segmentsContainer.appendChild(newSegment);
        this.updateSegmentIndices();
        // Initialize data for new segment
        this.segmentData[segmentCount] = { points: [], lines: [] };
    }

    removeSegment(index) {
        const segments = document.querySelectorAll('.segment');
        if (segments.length > 1) {
            // Remove all markers and lines for this segment
            const segmentData = this.segmentData[index];
            if (segmentData) {
                segmentData.points.forEach(point => this.map.removeLayer(point.marker));
                segmentData.lines.forEach(line => this.map.removeLayer(line));
            }
            
            // Remove from data array
            this.segmentData.splice(index, 1);
            
            // Remove from DOM
            segments[index].remove();
            
            // Update indices
            this.updateSegmentIndices();
            
            // If removed segment was active, activate first segment
            if (this.activeSegmentIndex === index) {
                this.setActiveSegment(0);
            } else if (this.activeSegmentIndex > index) {
                // Adjust active index if needed
                this.activeSegmentIndex--;
            }
        }
    }

    updateSegmentIndices() {
        const segments = document.querySelectorAll('.segment');
        segments.forEach((segment, index) => {
            const h3 = segment.querySelector('.segment-header');
            if (h3) {
                const icon = h3.querySelector('.toggle-icon');
                const iconText = icon ? icon.textContent : '';
                h3.innerHTML = `Segment ${index + 1} <span class="toggle-icon">${iconText || '▼'}</span>`;
            }
            segment.dataset.index = index;
        });

        // Show remove button only if more than one segment
        const removeButtons = document.querySelectorAll('.remove-segment');
        removeButtons.forEach(button => {
            button.style.display = segments.length > 1 ? 'inline-block' : 'none';
        });
    }

    calculateFuelConsumption() {
        const hfoStart = parseFloat(document.getElementById('hfo-start').value) || 0;
        const segments = document.querySelectorAll('.segment');
        const results = [];
        let currentRob = hfoStart;
        let hasWarning = false;

        segments.forEach((segment, index) => {
            const distance = parseFloat(segment.querySelector('.distance-nm').value) || 0;
            const rpm = parseFloat(segment.querySelector('.rpm').value) || 0;
            const weatherFactor = parseFloat(segment.querySelector('.weather-factor').value) || 1.0;
            let time = parseFloat(segment.querySelector('.time-h').value) || 0;
            const speed = parseFloat(segment.querySelector('.speed-kn').value) || 0;

            // Calculate time if not provided and speed is available
            if (time === 0 && speed > 0 && distance > 0) {
                time = this.calculateTime(distance, speed);
                segment.querySelector('.time-h').value = time.toFixed(2);
            }

            const consumptionRate = this.calculateConsumption(rpm, weatherFactor);
            const consumption = consumptionRate * time;
            currentRob -= consumption;

            // Check if ROB is greater than start (error condition)
            if (currentRob > hfoStart) {
                hasWarning = true;
            }

            results.push({
                segment: index + 1,
                consumption: consumption.toFixed(3),
                rob: Math.max(0, currentRob).toFixed(3) // Don't go below 0
            });
        });

        this.displayResults(results, hasWarning);

        // Show warning if ROB > HFO Start
        if (hasWarning) {
            alert('Warning: Check HFO Start - ROB value exceeds starting fuel.');
        }
    }

    displayResults(results, hasWarning) {
        const tbody = document.querySelector('#results-table tbody');
        tbody.innerHTML = '';

        results.forEach(result => {
            const row = document.createElement('tr');
            if (hasWarning) {
                row.style.backgroundColor = '#ffe6e6';
            }
            row.innerHTML = `
                <td>${result.segment}</td>
                <td>${result.consumption}</td>
                <td>${result.rob}</td>
            `;
            tbody.appendChild(row);
        });
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new FuelCalculator();
});