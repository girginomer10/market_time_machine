import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/global.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    const workerUrl = new URL("sw.js", appBaseUrl);

    void navigator.serviceWorker
      .register(workerUrl, {
        scope: appBaseUrl.pathname,
        updateViaCache: "none",
      })
      .catch((error: unknown) => {
        console.warn("Offline support could not be enabled.", error);
      });
  });
}
