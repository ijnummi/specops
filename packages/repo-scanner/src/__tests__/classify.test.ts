import { describe, expect, it } from "vitest";

import { classifySourceFile, isSupportedSourcePath, shouldExcludePath } from "../classify.js";

describe("source file classification", () => {
  it("accepts TypeScript and JavaScript source extensions", () => {
    expect(isSupportedSourcePath("src/index.ts")).toBe(true);
    expect(isSupportedSourcePath("src/view.tsx")).toBe(true);
    expect(isSupportedSourcePath("src/index.js")).toBe(true);
    expect(isSupportedSourcePath("src/view.jsx")).toBe(true);
    expect(isSupportedSourcePath("README.md")).toBe(false);
  });

  it("excludes heavy and generated paths", () => {
    expect(shouldExcludePath("node_modules/react/index.js")).toBe(true);
    expect(shouldExcludePath(".git/config")).toBe(true);
    expect(shouldExcludePath("dist/index.js")).toBe(true);
    expect(shouldExcludePath("apps/api/src/server.ts")).toBe(false);
  });

  it("classifies file language and kind", () => {
    expect(classifySourceFile("src/index.ts")).toEqual({ language: "typescript", kind: "source" });
    expect(classifySourceFile("src/App.tsx")).toEqual({ language: "tsx", kind: "source" });
    expect(classifySourceFile("src/App.test.tsx")).toEqual({ language: "tsx", kind: "test" });
    expect(classifySourceFile("vite.config.ts")).toEqual({ language: "typescript", kind: "config" });
    expect(classifySourceFile("src/main.ts")).toEqual({ language: "typescript", kind: "entrypoint" });
  });
});
