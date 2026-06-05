import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import type { AgentOrchestrationSpec } from "./types.js";

export interface InspectServerOptions {
  spec: AgentOrchestrationSpec;
  port?: number;
  portRangeEnd?: number;
  staticDir: string;
}

export interface InspectServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startInspectServer(options: InspectServerOptions): Promise<InspectServerHandle> {
  const startPort = options.port ?? 7322;
  const portRangeEnd = options.portRangeEnd ?? 7332;
  let lastError: unknown;

  for (let port = startPort; port <= portRangeEnd; port += 1) {
    try {
      const server = createInspectHttpServer(options.spec, options.staticDir);
      await listen(server, port);
      return {
        url: `http://localhost:${port}`,
        port,
        close: () => close(server),
      };
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) {
        throw error;
      }
    }
  }

  throw new Error(`No available port in range ${startPort}-${portRangeEnd}: ${errorMessage(lastError)}`);
}

function createInspectHttpServer(spec: AgentOrchestrationSpec, staticDir: string): Server {
  const root = resolve(staticDir);
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/spec") {
      const body = JSON.stringify(spec, null, 2);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = resolve(root, normalize(decodeURIComponent(requested)).replace(/^[/\\]+/, ""));
    if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": contentType(filePath) });
    createReadStream(filePath).pipe(res);
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolveClose();
      }
    });
  });
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EADDRINUSE";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
