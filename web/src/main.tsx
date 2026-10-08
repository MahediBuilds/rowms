import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";
import { AuthProvider, ToastProvider } from "./state";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err: any) => count < 1 && !(err?.status >= 400 && err?.status < 500),
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
