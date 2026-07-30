import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AppErrorBoundary } from './components/ui/designSystem.jsx';
import './style.css';
import './styles/legacy-runtime.css';
import './styles/phase9.css';

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
