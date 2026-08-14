document.documentElement.classList.toggle(
  "site-proxied",
  new URLSearchParams(location.search).get("proxied") === "1",
);
