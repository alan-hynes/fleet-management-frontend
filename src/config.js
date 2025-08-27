// src/config.js
const API_BASE =
  process.env.REACT_APP_API_BASE ||
  `http://${window.location.hostname}:3001`;

export { API_BASE };
