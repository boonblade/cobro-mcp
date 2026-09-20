import { createRoot } from 'react-dom/client';
function Cta({ label }) { return <button id="cta">{label}</button>; }
function App() {
  return <main><h1>React 19</h1><Cta label="Go" /></main>;
}
createRoot(document.getElementById('root')).render(<App />);
