// What every page shares: the stylesheet, the providers shadcn's components need
// (tooltips, toasts), and mounting a page into its <main>.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./styles/app.css";

export function mount(Page) {
  createRoot(document.getElementById("main-content")).render(
    <StrictMode>
      <TooltipProvider delayDuration={300}>
        <Page />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </StrictMode>,
  );
}
