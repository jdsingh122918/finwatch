import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared",
          root: "./shared",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "agent",
          root: "./agent",
          include: ["src/**/*.test.ts"],
        },
      },
    ],
  },
});
