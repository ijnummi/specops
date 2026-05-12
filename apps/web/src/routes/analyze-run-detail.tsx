type AnalyzeRunDetailPageProps = {
  projectId: string;
  runId: string;
};

export function AnalyzeRunDetailPage({ projectId, runId }: AnalyzeRunDetailPageProps) {
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold text-slate-900">Analyze Run</h1>
      <dl className="space-y-1 text-sm text-slate-600">
        <div>
          <dt className="font-medium text-slate-800">Project ID</dt>
          <dd>{projectId}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-800">Run ID</dt>
          <dd>{runId}</dd>
        </div>
      </dl>
    </section>
  );
}
