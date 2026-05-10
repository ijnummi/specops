import { describe, expect, it } from "vitest";

import { applySourceSpecAnnotations } from "./annotate.js";

describe("applySourceSpecAnnotations", () => {
  it("adds a JSDoc specops tag before a declaration line", () => {
    const result = applySourceSpecAnnotations({
      content: "export interface Decision { id: string }\n",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 1 }]
    });

    expect(result.content).toBe(
      "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n"
    );
    expect(result.changed).toBe(true);
  });

  it("preserves existing JSDoc while adding the specops tag", () => {
    const result = applySourceSpecAnnotations({
      content:
        "/**\n" +
        " * Domain object.\n" +
        " */\n" +
        "export interface Decision { id: string }\n",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 4 }]
    });

    expect(result.content).toContain(" * Domain object.\n * @specops domain.decision\n");
  });

  it("refuses conflicting specops tags on the target declaration", () => {
    expect(() =>
      applySourceSpecAnnotations({
        content:
          "/** @specops domain.other */\n" +
          "export interface Decision { id: string }\n",
        annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 2 }]
      })
    ).toThrow(/already has a different @specops annotation/);
  });

  it("leaves existing identical specops tags unchanged", () => {
    const content =
      "/**\n" +
      " * @specops domain.decision\n" +
      " */\n" +
      "export interface Decision { id: string }\n";

    const result = applySourceSpecAnnotations({
      content,
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 4 }]
    });

    expect(result.content).toBe(content);
    expect(result.changed).toBe(false);
  });

  it("applies multiple annotations from bottom to top without shifting earlier line numbers", () => {
    const result = applySourceSpecAnnotations({
      content:
        "export interface Workspace { id: string }\n" +
        "\n" +
        "export interface Decision { id: string }\n",
      annotations: [
        { entityId: "domain.workspace", symbolName: "Workspace", symbolLine: 1 },
        { entityId: "domain.decision", symbolName: "Decision", symbolLine: 3 }
      ]
    });

    expect(result.content).toBe(
      "/**\n" +
        " * @specops domain.workspace\n" +
        " */\n" +
        "export interface Workspace { id: string }\n" +
        "\n" +
        "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n"
    );
    expect(result.changed).toBe(true);
  });

  it("handles source files without a trailing newline", () => {
    const result = applySourceSpecAnnotations({
      content: "export interface Decision { id: string }",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 1 }]
    });

    expect(result.content).toBe(
      "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }"
    );
    expect(result.changed).toBe(true);
  });
});
