import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { API_BASE } from './config';

// rewrite relative fetch calls to hit the backend on port 3001
const __origFetch = window.fetch;
window.fetch = (input, init) => {
  try {
    if (
      typeof input === 'string' &&
      (input.startsWith('/api/') ||
        input === '/api' ||
        input.startsWith('/locations') ||
        input.startsWith('/geofences') ||
        input.startsWith('/vehicles'))
    ) {
      input = API_BASE + (input.startsWith('/') ? input : `/${input}`);
    }
  } catch (_) {}
  return __origFetch(input, init);
};

// also rewrite XHR/axios relative calls
const __origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
  try {
    if (
      typeof url === 'string' &&
      (url.startsWith('/api/') ||
        url === '/api' ||
        url.startsWith('/locations') ||
        url.startsWith('/geofences') ||
        url.startsWith('/vehicles'))
    ) {
      url = API_BASE + (url.startsWith('/') ? url : `/${url}`);
    }
  } catch (_) {}
  return __origOpen.call(this, method, url, async, user, password);
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
reportWebVitals();
