// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/noto-sans-thai/wght.css";
import "./index.css";
import { ThemeProvider } from "./context/ThemeContext"; // Import provider
import { LanguageProvider } from "./context/LanguageContext";
import { installAuthenticatedFetch } from "./api/authenticatedFetch";

installAuthenticatedFetch();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>
  </React.StrictMode>
);
