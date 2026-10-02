import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial, sans-serif",
        gap: "1rem",
      }}
    >
      <h1 style={{ fontSize: "2rem", margin: 0 }}>404 — Page not found</h1>
      <p style={{ color: "#555" }}>This page doesn't exist in the cloned site.</p>
      <Link to="/" style={{ color: "#043873", fontWeight: 600 }}>
        Go to homepage
      </Link>
    </div>
  );
}
