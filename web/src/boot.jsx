// What every page shares: the stylesheet the current pages use, and mounting a page
// into its <main>.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import "./seen.css";

export function mount(Page) {
  createRoot(document.getElementById("main-content")).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
