import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

const scriptTag = document.querySelector('script[type="module"]');
if (scriptTag && scriptTag.src.includes('localhost')) {
  // keep dev fast + un-cached; prod builds are served behind the SW
} else if ('serviceWorker' in navigator && !location.hostname.includes('localhost') || 'serviceWorker' in navigator && location.protocol === 'https:') {
  if (localStorage.getItem('sw-off') !== '1') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}