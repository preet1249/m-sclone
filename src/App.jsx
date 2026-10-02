import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import routes from "./routes.json";
import NotFound from "./NotFound.jsx";

function normalize(pathname) {
  if (!pathname) return "/";
  const stripped = pathname.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const routeMap = useMemo(() => {
    const map = new Map();
    for (const r of routes) map.set(normalize(r.path), r);
    return map;
  }, []);

  const current = routeMap.get(normalize(location.pathname));

  useEffect(() => {
    document.title = current ? current.title : "Page not found";
  }, [current]);

  useEffect(() => {
    function onMessage(event) {
      if (!event.data || event.data.type !== "mns-navigate") return;
      navigate(normalize(event.data.path));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  if (!current) return <NotFound />;

  return (
    <iframe
      key={current.slug}
      src={`/pages/${current.slug}/index.html`}
      title={current.title}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        border: "none",
        display: "block",
      }}
    />
  );
}
