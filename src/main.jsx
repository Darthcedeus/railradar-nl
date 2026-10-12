import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './style.css';
import App from '../tracker/App.jsx';
function Root() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return <App/>;
}
createRoot(document.getElementById('root')).render(<Root/>);
