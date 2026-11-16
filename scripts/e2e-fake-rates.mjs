// Disposable exchange-rate provider for the browser e2e stack. Corefinance
// points RATE_URL here instead of frankfurter.dev, so a USD record's rate is
// deterministic and the suite runs offline.
import http from "node:http";

const port = Number(process.env.PORT || 16970);
const rates = {
  USD: 61.573,
  JPY: 0.39884,
  EUR: 0.66,
  PHP: 1,
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/currencies") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        USD: "United States Dollar",
        JPY: "Japanese Yen",
        EUR: "Euro",
        PHP: "Philippine Peso",
      }),
    );
    return;
  }

  const date = url.pathname.slice(1);
  const base = (url.searchParams.get("base") || "").toUpperCase();
  const symbols = (url.searchParams.get("symbols") || "").toUpperCase().split(",");
  const value = rates[base];
  if (!value || !symbols.includes("PHP") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ amount: 1, base, date, rates: { PHP: value } }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake exchange rates on http://127.0.0.1:${port}`);
});
