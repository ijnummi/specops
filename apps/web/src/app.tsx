import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider
} from "@tanstack/react-router";

import { AdminDatabasePage } from "./routes/admin-database.js";
import type { AdminDatabaseMode } from "./routes/admin-database.js";
import { AgentRunDetailPage } from "./routes/agent-run-detail.js";
import { AgentRunsPage } from "./routes/agent-runs.js";
import { AiPrefillPage } from "./routes/ai-prefill.js";
import { AnalyzeRunDetailPage } from "./routes/analyze-run-detail.js";
import { AnalyzeRunReviewPage } from "./routes/analyze-run-review.js";
import { ChangeImpactPage } from "./routes/change-impact.js";
import { ConceptsPage } from "./routes/concepts.js";
import { DiffReviewDetailPage } from "./routes/diff-review-detail.js";
import { DiffReviewsPage } from "./routes/diff-reviews.js";
import { ImpactPage } from "./routes/impact.js";
import type { ImpactSearchDepth } from "./routes/impact.js";
import { ProjectDetailPage } from "./routes/project-detail.js";
import { ProjectGraphPage } from "./routes/project-graph.js";
import { ProjectHealthQueuePage } from "./routes/project-health-queue.js";
import { ProjectsPage } from "./routes/projects.js";
import { ReadinessPage } from "./routes/readiness.js";
import { RootRoute } from "./routes/root.js";
import { SourceImportPage } from "./routes/source-import.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

const rootRoute = createRootRoute({
  component: RootRoute
});

function parseImpactSearch(search: Record<string, unknown>) {
  const depth: ImpactSearchDepth =
    search.depth === 2 || search.depth === "2" ? 2 : search.depth === "all" ? "all" : 1;

  return {
    depth,
    direction:
      search.direction === "upstream" || search.direction === "downstream"
        ? search.direction
        : "both",
    includeSource: search.includeSource === false || search.includeSource === "false" ? false : true
  } as const;
}

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ProjectsPage
});

const adminDatabaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/database",
  validateSearch: (search: Record<string, unknown>) => ({
    table: typeof search.table === "string" ? search.table : undefined,
    mode: readAdminDatabaseMode(search.mode),
    rowId: typeof search.rowId === "string" ? search.rowId : undefined
  }),
  component: () => {
    const { table, mode, rowId } = adminDatabaseRoute.useSearch();
    return <AdminDatabasePage tableName={table} mode={mode} rowId={rowId} />;
  }
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined
  }),
  component: () => {
    const { projectId } = projectRoute.useParams();
    const { q } = projectRoute.useSearch();
    return <ProjectDetailPage projectId={projectId} entityId={null} query={q ?? ""} />;
  }
});

const projectGraphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/graph",
  component: () => {
    const { projectId } = projectGraphRoute.useParams();
    return <ProjectGraphPage projectId={projectId} />;
  }
});

const conceptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/concepts",
  component: () => {
    const { projectId } = conceptsRoute.useParams();
    return <ConceptsPage projectId={projectId} />;
  }
});

const entityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/entities/$entityId",
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined
  }),
  component: () => {
    const { projectId, entityId } = entityRoute.useParams();
    const { q } = entityRoute.useSearch();
    return <ProjectDetailPage projectId={projectId} entityId={entityId} query={q ?? ""} />;
  }
});

const readinessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/readiness",
  component: () => {
    const { projectId } = readinessRoute.useParams();
    return <ReadinessPage projectId={projectId} />;
  }
});

const projectHealthQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/health-queue",
  component: () => {
    const { projectId } = projectHealthQueueRoute.useParams();
    return <ProjectHealthQueuePage projectId={projectId} />;
  }
});

const agentRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/agent-runs",
  component: () => {
    const { projectId } = agentRunsRoute.useParams();
    return <AgentRunsPage projectId={projectId} />;
  }
});

const agentRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/agent-runs/$runId",
  component: () => {
    const { projectId, runId } = agentRunDetailRoute.useParams();
    return <AgentRunDetailPage projectId={projectId} runId={runId} />;
  }
});

const analyzeRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/analyze-runs/$runId",
  component: () => {
    const { projectId, runId } = analyzeRunDetailRoute.useParams();
    return <AnalyzeRunDetailPage projectId={projectId} runId={runId} />;
  }
});

const analyzeRunReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/analyze-runs/$runId/review",
  component: () => {
    const { projectId, runId } = analyzeRunReviewRoute.useParams();
    return <AnalyzeRunReviewPage projectId={projectId} runId={runId} />;
  }
});

const diffReviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/diff-reviews",
  component: () => {
    const { projectId } = diffReviewsRoute.useParams();
    return <DiffReviewsPage projectId={projectId} />;
  }
});

const diffReviewDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/diff-reviews/$reviewId",
  component: () => {
    const { projectId, reviewId } = diffReviewDetailRoute.useParams();
    return <DiffReviewDetailPage projectId={projectId} reviewId={reviewId} />;
  }
});

const sourceImportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/import/source",
  component: () => {
    const { projectId } = sourceImportRoute.useParams();
    return <SourceImportPage projectId={projectId} />;
  }
});

const aiPrefillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/ai-prefill",
  component: () => {
    const { projectId } = aiPrefillRoute.useParams();
    return <AiPrefillPage projectId={projectId} />;
  }
});

const impactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/impact/$entityId",
  validateSearch: parseImpactSearch,
  component: () => {
    const { projectId, entityId } = impactRoute.useParams();
    const { depth, direction, includeSource } = impactRoute.useSearch();
    return (
      <ImpactPage
        projectId={projectId}
        entityId={entityId}
        depth={depth}
        direction={direction}
        includeSource={includeSource}
      />
    );
  }
});

const changeImpactRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/change-impact/$entityId",
  validateSearch: parseImpactSearch,
  component: () => {
    const { projectId, entityId } = changeImpactRoute.useParams();
    const { depth, direction, includeSource } = changeImpactRoute.useSearch();
    return (
      <ChangeImpactPage
        projectId={projectId}
        entityId={entityId}
        depth={depth}
        direction={direction}
        includeSource={includeSource}
      />
    );
  }
});

const routeTree = rootRoute.addChildren([
  projectsRoute,
  adminDatabaseRoute,
  projectRoute,
  projectGraphRoute,
  conceptsRoute,
  entityRoute,
  readinessRoute,
  projectHealthQueueRoute,
  agentRunsRoute,
  agentRunDetailRoute,
  analyzeRunDetailRoute,
  analyzeRunReviewRoute,
  diffReviewsRoute,
  diffReviewDetailRoute,
  sourceImportRoute,
  aiPrefillRoute,
  impactRoute,
  changeImpactRoute
]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function readAdminDatabaseMode(value: unknown): AdminDatabaseMode {
  return value === "row" || value === "rows" ? value : "schema";
}
