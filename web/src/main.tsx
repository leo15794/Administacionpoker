import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// Instalar como app (13/10/2026, ver installPrompt.ts): side-effect import que engancha el
// listener de "beforeinstallprompt" lo antes posible, antes de que monte ningún componente.
import './installPrompt'

// Dentro de un panel de la vista dividida (iframe) la app se muestra sin menú ni barras: ver html.embebido en index.css.
if (window.self !== window.top) {
  document.documentElement.classList.add('embebido')
  // El tema (día/noche) se cambia en la ventana principal: el panel lo toma al instante cuando cambia en el navegador.
  window.addEventListener('storage', (e) => {
    if (e.key === 'dp_theme' && (e.newValue === 'light' || e.newValue === 'dark')) document.documentElement.setAttribute('data-theme', e.newValue)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker mínimo (ver public/sw.js) -- requisito de Chrome/Android para que el sitio
// se considere instalable y dispare "beforeinstallprompt". No hace nada de cache/offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Si falla (ej. navegador viejo, o un bloqueo de red) simplemente no habrá botón de
      // instalar -- el resto de la app funciona igual.
    })
  })
}
