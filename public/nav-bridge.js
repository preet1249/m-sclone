// Injected into every cloned page (running inside its iframe). Intercepts
// clicks on internal links so the outer app can do SPA-style navigation
// (keeps the address bar + back/forward in sync) instead of the iframe
// doing its own full navigation. External links, mailto/tel, hash links,
// and target="_blank" links are left completely alone.
(function () {
  var SKIP_PREFIXES = ["/wp-", "/feed", "/comments", "/xmlrpc.php", "/robots.txt", "/wp-json"];

  document.addEventListener(
    "click",
    function (e) {
      var a = e.target.closest("a");
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) return;
      if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("wa.me")) return;
      if (a.target === "_blank") return;
      if (/^https?:\/\//i.test(href) || href.startsWith("//")) return;
      if (!href.startsWith("/")) return;

      var normalized = href.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
      for (var i = 0; i < SKIP_PREFIXES.length; i++) {
        if (normalized.indexOf(SKIP_PREFIXES[i]) === 0) return;
      }

      e.preventDefault();
      window.parent.postMessage({ type: "mns-navigate", path: normalized }, window.location.origin === "null" ? "*" : "*");
    },
    true
  );
})();
