import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ProveedorAvisos } from './ui.jsx';
import './estilos.css';

createRoot(document.getElementById('raiz')).render(
  <ProveedorAvisos><App /></ProveedorAvisos>,
);
