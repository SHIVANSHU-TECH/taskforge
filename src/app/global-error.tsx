"use client";

import { useEffect } from "react";

/**
 * Root fallback used when the error happens above the app layout (rare). It must
 * render its own <html>/<body>. Kept dependency-free and inline-styled since the
 * app shell may not be available at this point.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#0b0f1a",
          color: "#e6ebf4",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ color: "#9aa4b8", marginTop: "0.5rem", maxWidth: "28rem" }}>
          The application hit an unexpected error. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.6rem 1.1rem",
            background: "#ea580c",
            color: "#fff",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
