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

  it("does not modify a regular block comment before the declaration", () => {
    const result = applySourceSpecAnnotations({
      content:
        "/**\n" +
        " * File overview.\n" +
        " */\n" +
        "/* Internal note. */\n" +
        "export interface Decision { id: string }\n",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 5 }]
    });

    expect(result.content).toBe(
      "/**\n" +
        " * File overview.\n" +
        " */\n" +
        "/* Internal note. */\n" +
        "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision { id: string }\n"
    );
  });

  it("does not treat code containing a block close token as leading JSDoc", () => {
    const result = applySourceSpecAnnotations({
      content: '/** File overview. */\nconst marker = "*/";\nexport interface Decision {}\n',
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 3 }]
    });

    expect(result.content).toBe(
      "/** File overview. */\n" +
        'const marker = "*/";\n' +
        "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision {}\n"
    );
  });

  it("does not treat blank-line-separated JSDoc as attached to the declaration", () => {
    const result = applySourceSpecAnnotations({
      content: "/** File overview. */\n\nexport interface Decision {}\n",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 3 }]
    });

    expect(result.content).toBe(
      "/** File overview. */\n" +
        "\n" +
        "/**\n" +
        " * @specops domain.decision\n" +
        " */\n" +
        "export interface Decision {}\n"
    );
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

  it("refuses multiple annotations targeting the same source line", () => {
    expect(() =>
      applySourceSpecAnnotations({
        content: "export const DecisionService = {}; export const ReminderScheduler = {};\n",
        annotations: [
          { entityId: "interface.decision-service", symbolName: "DecisionService", symbolLine: 1 },
          {
            entityId: "interface.reminder-scheduler",
            symbolName: "ReminderScheduler",
            symbolLine: 1
          }
        ]
      })
    ).toThrow(/Multiple source annotations target line/);
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

  it("preserves CRLF line endings when inserting annotations", () => {
    const result = applySourceSpecAnnotations({
      content: "export interface Decision { id: string }\r\n",
      annotations: [{ entityId: "domain.decision", symbolName: "Decision", symbolLine: 1 }]
    });

    expect(result.content).toBe(
      "/**\r\n" +
        " * @specops domain.decision\r\n" +
        " */\r\n" +
        "export interface Decision { id: string }\r\n"
    );
  });
});
