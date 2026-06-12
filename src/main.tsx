import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// No StrictMode: it double-mounts effects in dev, which races the async
// engine init against teardown (WebGL context + fragments worker) and throws.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
