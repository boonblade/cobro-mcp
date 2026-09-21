import { createRoot } from 'react-dom/client'; import { Button } from '../lib/node_modules/fake-ui/index.js';
function Cta({ label }) { return <button id="cta">{label}</button>; }
function App() {
  return <main><h1>React 19</h1><Cta label="Go" /><Button id="libcta">Lib</Button></main>;
}
createRoot(document.getElementById('root')).render(<App />);
