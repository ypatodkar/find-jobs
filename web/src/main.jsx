// Entry for the all-jobs page. styles.css is the same file the current pages use.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import "./seen.css";
import "../../data.js"; // the investor list, as window.VC_FIRMS
import App from "./App.jsx";

createRoot(document.getElementById("main-content")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
