import React, { useState, useEffect, useRef, useMemo } from "react";
import { GoogleMap, useLoadScript, Polyline, Polygon, Circle, InfoWindow } from "@react-google-maps/api";
import io from "socket.io-client";
import { API_BASE } from "./config";

const mapContainerStyle = { width: "100vw", height: "70vh" };
const defaultCenter = { lat: 53.3498053, lng: -6.2603097 }; // Dublin

function MapComponent() {
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
  });

  const [vehicles, setVehicles] = useState([]);
  const [routes, setRoutes] = useState({});
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  
  // Geofencing state
  const [geofences, setGeofences] = useState([]);
  const [violations, setViolations] = useState([]);
  const [showGeofenceManager, setShowGeofenceManager] = useState(false);
  const [showViolationsDashboard, setShowViolationsDashboard] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingType, setDrawingType] = useState('polygon');
  const [currentPath, setCurrentPath] = useState([]);
  const [selectedGeofence, setSelectedGeofence] = useState(null);
  const [showGeofenceInfo, setShowGeofenceInfo] = useState(false);
  const [realtimeAlert, setRealtimeAlert] = useState(null);

  const mapRef = useRef(null);
  const boundsRef = useRef(null);
  const socketRef = useRef(null);
  const hasCentered = useRef(false);

  const options = useMemo(
    () => ({ disableDefaultUI: false, zoomControl: true, draggable: true }),
    []
  );

  // Fetch initial data
  useEffect(() => {
    fetchVehicles();
    fetchGeofences();
    fetchViolations();
  }, []);

  const fetchVehicles = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/locations`);
      const data = await res.json();
      setVehicles(data);
      setRoutes((prev) => {
        const next = { ...prev };
        data.forEach((v) => {
          if (!next[v.id]) next[v.id] = [];
          next[v.id].push({ lat: v.lat, lng: v.lng });
        });
        return next;
      });
    } catch (err) {
      console.error("Initial /api/locations fetch failed:", err);
    }
  };

  const fetchGeofences = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/geofences`);
      const data = await res.json();
      setGeofences(data);
    } catch (err) {
      console.error("Error fetching geofences:", err);
    }
  };

  const fetchViolations = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/violations`);
      const data = await res.json();
      setViolations(data);
    } catch (err) {
      console.error("Error fetching violations:", err);
    }
  };

  // Socket.IO for real-time updates
  useEffect(() => {
    const SOCKET_URL =
      process.env.REACT_APP_BACKEND_URL || API_BASE || `http://${window.location.hostname}:3001`;

    socketRef.current = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      withCredentials: false,
    });

    socketRef.current.on("vehicleUpdate", (updatedVehicles) => {
      setVehicles(updatedVehicles);
      setRoutes((prev) => {
        const next = { ...prev };
        updatedVehicles.forEach((v) => {
          if (!next[v.id]) next[v.id] = [];
          next[v.id].push({ lat: v.lat, lng: v.lng });
        });
        return next;
      });
    });

    // Listen for geofence alerts
    socketRef.current.on("geofence_alert", (alert) => {
      setRealtimeAlert(alert);
      fetchViolations(); // Refresh violations list
      
      // Auto-hide alert after 5 seconds
      setTimeout(() => setRealtimeAlert(null), 5000);
    });

    return () => {
      socketRef.current && socketRef.current.disconnect();
    };
  }, []);

  // Handle map clicks for drawing
  const handleMapClick = (event) => {
    if (!isDrawing || drawingType !== 'polygon') return;

    const lat = event.latLng.lat();
    const lng = event.latLng.lng();
    
    setCurrentPath(prev => [...prev, { lat, lng }]);
  };

  // Start drawing a geofence
  const startDrawing = (type) => {
    setDrawingType(type);
    setIsDrawing(true);
    setCurrentPath([]);
  };

  // Finish drawing and save geofence
  const finishDrawing = async () => {
    if (currentPath.length < 3 && drawingType === 'polygon') {
      alert('Polygon needs at least 3 points');
      return;
    }

    const name = prompt('Enter geofence name:');
    if (!name) return;

    try {
      const geofenceData = {
        name,
        type: drawingType,
        coordinates: drawingType === 'polygon' 
          ? currentPath.map(p => [p.lng, p.lat]) // Convert to [lng, lat] format
          : [currentPath[0].lng, currentPath[0].lat], // Circle center
        radius: drawingType === 'circle' ? 1000 : undefined,
        alertOnEntry: true,
        alertOnExit: true
      };

      const response = await fetch(`${API_BASE}/api/geofences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geofenceData)
      });

      if (response.ok) {
        fetchGeofences(); // Refresh geofences
      }
    } catch (error) {
      console.error('Error creating geofence:', error);
    }

    // Reset drawing state
    setIsDrawing(false);
    setCurrentPath([]);
  };

  // Cancel drawing
  const cancelDrawing = () => {
    setIsDrawing(false);
    setCurrentPath([]);
  };

  // Delete geofence
  const deleteGeofence = async (geofenceId) => {
    try {
      const response = await fetch(`${API_BASE}/api/geofences/${geofenceId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        fetchGeofences();
        setSelectedGeofence(null);
        setShowGeofenceInfo(false);
      }
    } catch (error) {
      console.error('Error deleting geofence:', error);
    }
  };

  // Resolve violation
  const resolveViolation = async (violationId) => {
    try {
      const response = await fetch(`${API_BASE}/api/violations/${violationId}/resolve`, {
        method: 'PATCH'
      });

      if (response.ok) {
        fetchViolations();
      }
    } catch (error) {
      console.error('Error resolving violation:', error);
    }
  };

  // Render markers and fit bounds
  useEffect(() => {
    if (mapRef.current && vehicles.length > 0) {
      const mapInstance = mapRef.current.map;

      // Clear old markers
      mapRef.current.markers.forEach((m) => m.setMap(null));
      mapRef.current.markers = [];

      if (!hasCentered.current) boundsRef.current = new window.google.maps.LatLngBounds();

      vehicles.forEach((v) => {
        const icon =
          v.alert === "breakdown"
            ? "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
            : v.alert === "idle"
            ? "http://maps.google.com/mapfiles/ms/icons/yellow-dot.png"
            : "http://maps.google.com/mapfiles/ms/icons/green-dot.png";

        const marker = new window.google.maps.Marker({
          map: mapInstance,
          position: { lat: v.lat, lng: v.lng },
          title: `${v.address} - ${v.status}`,
          icon,
        });

        marker.addListener("click", () => setSelectedVehicleId(v.id));
        mapRef.current.markers.push(marker);

        if (!hasCentered.current) boundsRef.current.extend(marker.getPosition());
      });

      if (!hasCentered.current) {
        mapInstance.fitBounds(boundsRef.current);
        hasCentered.current = true;
      }
    }
  }, [vehicles]);

  if (!isLoaded) return <div>Loading Map...</div>;

  const filteredViolations = violations.slice(0, 10); // Show last 10

  return (
    <div>
      {/* Real-time Alert */}
      {realtimeAlert && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '15px 25px',
          backgroundColor: realtimeAlert.type === 'entry' ? '#4CAF50' : '#f44336',
          color: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          zIndex: 2000,
          fontSize: '16px',
          fontWeight: 'bold'
        }}>
          🚨 {realtimeAlert.message}
        </div>
      )}

      {/* Geofence Manager */}
      {showGeofenceManager && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'white',
          padding: '15px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          zIndex: 1000,
          minWidth: '250px'
        }}>
          <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Geofence Manager</h3>
          
          {!isDrawing ? (
            <div>
              <button 
                onClick={() => startDrawing('polygon')}
                style={{
                  width: '100%',
                  padding: '8px',
                  margin: '5px 0',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Draw Polygon
              </button>
              <button 
                onClick={() => startDrawing('circle')}
                style={{
                  width: '100%',
                  padding: '8px',
                  margin: '5px 0',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Draw Circle
              </button>
            </div>
          ) : (
            <div>
              <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
                Drawing {drawingType}... ({currentPath.length} points)
              </p>
              <button 
                onClick={finishDrawing}
                style={{
                  width: '48%',
                  padding: '8px',
                  margin: '2px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Finish
              </button>
              <button 
                onClick={cancelDrawing}
                style={{
                  width: '48%',
                  padding: '8px',
                  margin: '2px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          )}

          <div style={{ marginTop: '15px', maxHeight: '200px', overflowY: 'auto' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Geofences ({geofences.length}):</h4>
            {geofences.map(geofence => (
              <div 
                key={geofence._id} 
                style={{
                  padding: '8px',
                  margin: '5px 0',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '4px',
                  fontSize: '12px',
                  border: '1px solid #ddd'
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{geofence.name}</div>
                <div style={{ color: '#666' }}>{geofence.type}</div>
                <button 
                  onClick={() => deleteGeofence(geofence._id)}
                  style={{
                    padding: '4px 8px',
                    marginTop: '5px',
                    fontSize: '10px',
                    backgroundColor: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Violations Dashboard */}
      {showViolationsDashboard && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          left: '20px',
          width: '350px',
          maxHeight: '400px',
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          zIndex: 1000,
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '15px',
            borderBottom: '1px solid #eee',
            backgroundColor: '#f8f9fa'
          }}>
            <h3 style={{ margin: '0 0 5px 0', fontSize: '16px' }}>
              🚨 Recent Violations ({violations.length})
            </h3>
          </div>

          <div style={{
            maxHeight: '250px',
            overflowY: 'auto',
            padding: '10px'
          }}>
            {filteredViolations.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '20px', 
                color: '#666',
                fontSize: '14px'
              }}>
                No recent violations
              </div>
            ) : (
              filteredViolations.map(violation => (
                <div 
                  key={violation._id}
                  style={{
                    margin: '8px 0',
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: violation.resolved ? '#e8f5e8' : 
                      violation.violationType === 'entry' ? '#fff3cd' : '#f8d7da',
                    border: '1px solid #ddd',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '5px'
                  }}>
                    <div>
                      <span style={{ fontSize: '14px', marginRight: '5px' }}>
                        {violation.violationType === 'entry' ? '🟢' : '🔴'}
                      </span>
                      <strong>{violation.vehicleId}</strong>
                    </div>
                    
                    {!violation.resolved && (
                      <button
                        onClick={() => resolveViolation(violation._id)}
                        style={{
                          padding: '3px 6px',
                          fontSize: '9px',
                          backgroundColor: '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        Resolve
                      </button>
                    )}
                  </div>

                  <div style={{ marginBottom: '3px' }}>
                    <strong>{violation.geofenceName}</strong> ({violation.violationType})
                  </div>
                  
                  <div style={{ color: '#666' }}>
                    {new Date(violation.timestamp).toLocaleString()}
                  </div>

                  {violation.resolved && (
                    <div style={{ color: '#28a745', fontSize: '10px', marginTop: '3px' }}>
                      ✅ Resolved
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'white',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        zIndex: 1000
      }}>
        <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Fleet Management</h2>
        
        <div style={{ marginBottom: '10px' }}>
          <strong>Active Vehicles: {vehicles.length}</strong>
        </div>

        <div style={{ marginBottom: '15px', fontSize: '14px' }}>
          {vehicles.map(vehicle => (
            <div key={vehicle.id} style={{ margin: '5px 0' }}>
              <span style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: vehicle.status === 'breakdown' ? '#f44336' : 
                               vehicle.status === 'idle' ? '#FF9800' : '#4CAF50',
                display: 'inline-block',
                marginRight: '8px'
              }}></span>
              {vehicle.id} - {vehicle.status}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={() => setShowGeofenceManager(!showGeofenceManager)}
            style={{
              padding: '8px 12px',
              backgroundColor: showGeofenceManager ? '#ff9800' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {showGeofenceManager ? 'Hide' : 'Show'} Geofence Manager
          </button>

          <button
            onClick={() => setShowViolationsDashboard(!showViolationsDashboard)}
            style={{
              padding: '8px 12px',
              backgroundColor: showViolationsDashboard ? '#ff9800' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {showViolationsDashboard ? 'Hide' : 'Show'} Violations
          </button>
        </div>
      </div>

      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={defaultCenter}
        zoom={7}
        options={options}
        onClick={handleMapClick}
        onLoad={(map) => {
          mapRef.current = { map, markers: [] };
        }}
      >
        {/* Vehicle routes */}
        {selectedVehicleId && routes[selectedVehicleId] && (
          <Polyline
            path={routes[selectedVehicleId]}
            options={{ strokeColor: "#FF0000", strokeOpacity: 0.8, strokeWeight: 4 }}
          />
        )}
        {Object.entries(routes).map(([vehicleId, route]) =>
          vehicleId !== selectedVehicleId ? (
            <Polyline
              key={vehicleId}
              path={route}
              options={{ strokeColor: "#0000FF", strokeOpacity: 0.5, strokeWeight: 2 }}
            />
          ) : null
        )}

        {/* Existing geofences */}
        {geofences.map(geofence => (
          geofence.type === 'polygon' ? (
            <Polygon
              key={geofence._id}
              paths={geofence.coordinates.map(coord => ({
                lat: coord[1], 
                lng: coord[0]
              }))}
              options={{
                fillColor: '#4CAF50',
                fillOpacity: 0.2,
                strokeColor: '#4CAF50',
                strokeOpacity: 0.8,
                strokeWeight: 2,
                clickable: true
              }}
              onClick={() => {
                setSelectedGeofence(geofence);
                setShowGeofenceInfo(true);
              }}
            />
          ) : (
            <Circle
              key={geofence._id}
              center={{
                lat: geofence.coordinates[1],
                lng: geofence.coordinates[0]
              }}
              radius={geofence.radius || 1000}
              options={{
                fillColor: '#2196F3',
                fillOpacity: 0.2,
                strokeColor: '#2196F3',
                strokeOpacity: 0.8,
                strokeWeight: 2,
                clickable: true
              }}
              onClick={() => {
                setSelectedGeofence(geofence);
                setShowGeofenceInfo(true);
              }}
            />
          )
        ))}

        {/* Current drawing polygon */}
        {isDrawing && drawingType === 'polygon' && currentPath.length > 0 && (
          <Polygon
            paths={currentPath}
            options={{
              fillColor: '#FFC107',
              fillOpacity: 0.3,
              strokeColor: '#FFC107',
              strokeOpacity: 1,
              strokeWeight: 2
            }}
          />
        )}

        {/* Info window for selected geofence */}
        {showGeofenceInfo && selectedGeofence && (
          <InfoWindow
            position={
              selectedGeofence.type === 'polygon'
                ? {
                    lat: selectedGeofence.coordinates[0][1],
                    lng: selectedGeofence.coordinates[0][0]
                  }
                : {
                    lat: selectedGeofence.coordinates[1],
                    lng: selectedGeofence.coordinates[0]
                  }
            }
            onCloseClick={() => setShowGeofenceInfo(false)}
          >
            <div>
              <h3>{selectedGeofence.name}</h3>
              <p><strong>Type:</strong> {selectedGeofence.type}</p>
              <p><strong>Created:</strong> {new Date(selectedGeofence.createdAt).toLocaleDateString()}</p>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      <div style={{ padding: "20px" }}>
        <h2>Vehicle Status</h2>
        <table border="1" style={{ width: "100%", textAlign: "left" }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Address</th>
              <th>Status</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td>{v.id}</td>
                <td>{v.address}</td>
                <td>{v.status}</td>
                <td>{new Date(v.lastUpdated).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MapComponent;
