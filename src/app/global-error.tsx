"use client";

/**
 * The last resort: a throw in the root layout itself.
 *
 * Replaces the whole document, so it must render its own <html> and <body> and
 * cannot rely on the app's layout, styles or components — the layout is what
 * failed. Everything here is inline for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "1.5rem",
          textAlign: "center",
          color: "#0f172a",
          background: "#f8fafc",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            Uncanned WhatsApp could not load
          </h1>

          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#475569" }}>
            Nothing you have saved is affected. Messages that arrive while this
            screen is showing are still received and stored — WhatsApp retries
            delivery for up to seven days.
          </p>

          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#0f172a",
              color: "#f8fafc",
              cursor: "pointer",
            }}
          >
            Try again
          </button>

          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "#94a3b8",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
