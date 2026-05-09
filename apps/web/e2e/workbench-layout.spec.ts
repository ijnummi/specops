import { expect, test } from "@playwright/test";

const project = {
  id: "demo",
  name: "Decision Workspace",
  slug: "decision-workspace",
  repoPath: "/Users/example/decision-workspace",
  specopsPath: "sample/specops",
  description: "Sample project",
  createdAt: "2026-05-09T12:00:00.000Z",
  updatedAt: "2026-05-09T12:00:00.000Z",
  entityCount: 4,
  linkCount: 5,
  validationErrorCount: 0,
  validationWarningCount: 0,
  lastIndexedAt: "2026-05-09T12:00:00.000Z"
};

const entities = [
  entity("uc.create-workspace", "use_case", "Create workspace", "use-cases/uc.create-workspace.md"),
  entity("uc.capture-decision", "use_case", "Capture decision", "use-cases/uc.capture-decision.md"),
  entity("domain.workspace", "domain_entity", "Workspace", "domain/workspace.md"),
  entity("adr-001-markdown-decision-log", "adr", "Markdown decision log", "decisions/adr-001-markdown-decision-log.md")
];

const links = [
  link("1", "uc.create-workspace", "domain.workspace", "uses", "frontmatter"),
  link("2", "uc.create-workspace", "uc.capture-decision", "next", "body"),
  link("3", "uc.create-workspace", "adr-001-markdown-decision-log", "supports", "body")
];

test("project workbench fits one browser viewport with links at the bottom", async ({ page }) => {
  await page.route("**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (url.pathname === "/api/projects/demo") {
      await route.fulfill({ json: project });
      return;
    }
    if (url.pathname === "/api/projects/demo/entities") {
      await route.fulfill({ json: entities });
      return;
    }
    if (url.pathname === "/api/projects/demo/entities/uc.create-workspace") {
      await route.fulfill({ json: entities[0] });
      return;
    }
    if (url.pathname === "/api/projects/demo/entities/uc.create-workspace/outgoing-links") {
      await route.fulfill({ json: links });
      return;
    }
    if (url.pathname === "/api/projects/demo/entities/uc.create-workspace/backlinks") {
      await route.fulfill({ json: [link("4", "domain.workspace", "uc.create-workspace", "referenced by", "body")] });
      return;
    }
    if (url.pathname === "/api/projects/demo/validation-messages") {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname === "/api/projects/demo/index-runs") {
      await route.fulfill({
        json: [
          {
            id: "run-1",
            projectId: "demo",
            status: "completed",
            entityCount: 4,
            linkCount: 5,
            validationErrorCount: 0,
            validationWarningCount: 0,
            startedAt: "2026-05-09T12:00:00.000Z",
            finishedAt: "2026-05-09T12:00:01.000Z"
          }
        ]
      });
      return;
    }

    await route.fulfill({ status: 404, json: { message: `Unhandled ${url.pathname}` } });
  });

  await page.goto("/projects/demo/entities/uc.create-workspace");
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  const documentHeight = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  );
  expect(documentHeight).toBeLessThanOrEqual(viewport!.height);

  const editorBox = await page.getByTestId("entity-editor-panel").boundingBox();
  const linkBox = await page.getByTestId("link-panels").boundingBox();
  expect(editorBox).not.toBeNull();
  expect(linkBox).not.toBeNull();

  const ratio = editorBox!.height / linkBox!.height;
  const linkBottom = linkBox!.y + linkBox!.height;
  expect(ratio).toBeGreaterThan(2.3);
  expect(ratio).toBeLessThan(3.7);
  expect(linkBottom).toBeGreaterThanOrEqual(viewport!.height - 24);
  expect(linkBottom).toBeLessThanOrEqual(viewport!.height);
});

function entity(entityId: string, type: string, title: string, filePath: string) {
  return {
    id: entityId,
    projectId: "demo",
    entityId,
    type,
    title,
    status: "draft",
    filePath,
    frontmatter: { id: entityId, type, title, status: "draft" },
    bodyMarkdown: "## Flow\n\nThis is sample markdown with enough text to show the editor surface.\n",
    bodyText: "Flow. This is sample markdown with enough text to show the editor surface.",
    contentHash: `${entityId}-hash`,
    markdown: `---\nid: "${entityId}"\ntype: "${type}"\ntitle: "${title}"\nstatus: "draft"\n---\n\n## Flow\n\nThis is sample markdown with enough text to show the editor surface.\n`,
    createdAt: "2026-05-09T12:00:00.000Z",
    updatedAt: "2026-05-09T12:00:00.000Z"
  };
}

function link(
  id: string,
  fromEntityId: string,
  toEntityId: string,
  linkType: string,
  source: string
) {
  return {
    id,
    projectId: "demo",
    fromEntityId,
    toEntityId,
    linkType,
    source,
    confidence: 1,
    createdAt: "2026-05-09T12:00:00.000Z"
  };
}
