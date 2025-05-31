import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { StorageProvider } from './storage-context.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <StorageProvider>
        <App />
      </StorageProvider>
    </HashRouter>
  </React.StrictMode>,
);
