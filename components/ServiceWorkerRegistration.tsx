"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
      navigator.serviceWorker.register(`${base}/sw.js`)
        .then(() => navigator.serviceWorker.ready)
        .then(() => fetch(`${base}/api/offline/catalog/`, { credentials: "omit", cache: "no-cache" }))
        .catch(() => undefined);
    }
  }, []);
  return null;
}
