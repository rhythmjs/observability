import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      "log/log": "src/log/log.ts",
      "request-id/request-id": "src/request-id/request-id.ts",
      "timing/timing": "src/timing/timing.ts",
    },
    format: "esm",
    dts: true,
    fixedExtension: false,
    clean: true,
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**"],
    printWidth: 120,
    singleQuote: false,
    semi: true,
  },
});
