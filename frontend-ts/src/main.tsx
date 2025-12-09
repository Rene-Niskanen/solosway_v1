// CRITICAL: Import key validator FIRST to intercept all React.createElement calls
import "./utils/keyValidator";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
