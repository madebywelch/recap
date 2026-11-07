import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { startVibrancy } from "./vibrancy";
import "./styles.css";
import "./folio.css";
import "./studio.css";

if (isTauri()) {
  startVibrancy(
    () => invoke<boolean | null>("sidebar_vibrancy"),
    (enabled) => document.documentElement.classList.toggle("sidebar-vibrant", enabled),
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
