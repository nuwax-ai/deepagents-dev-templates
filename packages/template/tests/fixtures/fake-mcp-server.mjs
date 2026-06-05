import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (!message.id) return;

  if (message.method === "initialize") {
    send(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-mcp", version: "0.0.1" },
    });
    return;
  }

  if (message.method === "tools/call") {
    send(message.id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            tool: message.params.name,
            arguments: message.params.arguments,
          }),
        },
      ],
    });
    return;
  }

  if (message.method === "tools/list") {
    send(message.id, {
      tools: [
        {
          name: "echo",
          description: "Echo arguments",
          inputSchema: {
            type: "object",
            properties: {
              value: { type: "number" },
            },
            required: ["value"],
          },
        },
      ],
    });
    return;
  }

  send(message.id, {});
});
