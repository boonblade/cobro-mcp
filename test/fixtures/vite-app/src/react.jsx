import { createRoot } from 'react-dom/client'; import { Button } from '../lib/node_modules/fake-ui/index.js'; import { Button as WrapButton } from './ui/Button.jsx'; import { ReButton } from './ui/reexport.js';
function Cta({ label }) { return <button id="cta">{label}</button>; }
function App() {
  return <main><h1>React 19</h1><Cta label="Go" /><Button id="libcta">Lib</Button><WrapButton id="wrapcta">Wrap</WrapButton><ReButton id="recta">Re</ReButton><Button id="slotcta"><span id="slotinner">Hi</span></Button></main>;
}
createRoot(document.getElementById('root')).render(<App />);
