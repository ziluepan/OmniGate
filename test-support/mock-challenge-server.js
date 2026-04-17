import http from "node:http";
import { fileURLToPath } from "node:url";

export function createMockChallengeServer(port = 0, host = "127.0.0.1") {
  let solved = false;

  const server = http.createServer((req, res) => {
    // CORS headers just in case
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.url === "/api/solve" && req.method === "POST") {
      // Simulate artificial "operator" solving event
      solved = true;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Challenge solved by operator" }));
      return;
    }

    if (req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ solved }));
      return;
    }

    if (req.url === "/reset" && req.method === "POST") {
      solved = false;
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // We use a small polling script inside the mock page to remove the challenge
    // from the DOM once the server indicates it is solved.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${solved ? "Welcome to Mock Target" : "Security check"}</title>
      </head>
      <body>
        <div id="app">
          ${
            solved
              ? '<h1>Welcome to Mock Target</h1><p id="content">This is the protected content. Secret: 42</p>'
              : '<h1>Verify you are human</h1><p id="challenge-box">Please complete the security check to access the content.</p>'
          }
        </div>

        <script>
          setInterval(async () => {
            try {
              const response = await fetch("/api/status");
              const data = await response.json();
              if (data.solved && document.body.innerHTML.includes("Verify you")) {
                window.location.reload();
              }
            } catch (error) {}
          }, 500);
        </script>
      </body>
      </html>
    `);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;

      resolve({
        port: resolvedPort,
        close: () => new Promise((r) => server.close(r)),
        url: `http://${host}:${resolvedPort}`,
        setSolved: (value) => {
          solved = value;
        },
      });
    });
  });
}

if (
  import.meta.url.startsWith("file:") &&
  process.argv[1] === fileURLToPath(import.meta.url) &&
  !process.execArgv.includes("--test")
) {
  createMockChallengeServer(8080).then((server) => {
    console.log(`Mock challenge server listening on ${server.url}`);
    console.log(`To solve: curl -X POST ${server.url}/api/solve`);
  });
}
