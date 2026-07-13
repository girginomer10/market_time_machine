/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: { cwd: () => string };

export default defineConfig(({ command }) => {
  const productionLocalScenarioStub = `${process.cwd()}/src/data/scenarios/noLocalScenarioModules.ts`;

  return {
    plugins: [react()],
    resolve: {
      alias:
        command === "build"
          ? {
              "./localScenarioModules": productionLocalScenarioStub,
            }
          : undefined,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("lightweight-charts")) return "charts";
            return undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
