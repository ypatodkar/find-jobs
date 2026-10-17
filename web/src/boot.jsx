// What every page shares: the stylesheets, and mounting a page into its <main>.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/styles.css";
import "./styles/seen.css";

export function mount(Page) {
  createRoot(document.getElementById("main-content")).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
