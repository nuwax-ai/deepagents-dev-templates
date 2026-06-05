import type { DeepAgentGraphLike, DrawableGraphLike } from "../../src/graph-introspect.js";

export function createDrawableGraphFixture(): DrawableGraphLike {
  return {
    nodes: {
      __start__: { id: "__start__", name: "__start__" },
      agent: { id: "agent", name: "agent", metadata: { role: "model" } },
      tools: { id: "tools", name: "tools" },
      __end__: { id: "__end__", name: "__end__" },
    },
    edges: [
      { source: "__start__", target: "agent" },
      { source: "agent", target: "tools", data: "tool_calls", conditional: true },
      { source: "agent", target: "__end__", data: "done", conditional: true },
    ],
    drawMermaid: () => "flowchart TD\n  __start__ --> agent\n  agent --> tools\n  agent --> __end__",
  };
}

export function createAgentGraphFixture(): DeepAgentGraphLike {
  return {
    getGraphAsync: async () => createDrawableGraphFixture(),
    builder: {
      branches: {
        agent: {
          route: {
            ends: {
              tool_calls: "tools",
              done: "__end__",
            },
          },
        },
      },
    },
  };
}

export function createNestedAgentGraphFixture(): DeepAgentGraphLike {
  return {
    graph: {
      getGraphAsync: async () => createDrawableGraphFixture(),
      builder: {
        branches: {
          agent: {
            route: {
              ends: {
                done: "__end__",
              },
            },
          },
        },
      },
    },
  };
}
