import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply persisted theme before first paint (default dark).
document.documentElement.classList.toggle(
  "dark",
  (localStorage.getItem("theme") ?? "dark") === "dark",
);

// No StrictMode: it double-mounts effects in dev, which races the async
// engine init against teardown (WebGL context + fragments worker) and throws.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
