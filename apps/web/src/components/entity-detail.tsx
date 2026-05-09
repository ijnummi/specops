import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";

import {
  backlinksQuery,
  entityQuery,
  outgoingLinksQuery,
  queryKeys,
  updateEntityMarkdown,
  validationMessagesQuery
} from "../api/queries.js";
import { LinkPanels } from "./link-panels.js";
import { MarkdownEditor } from "./markdown-editor.js";

type EntityDetailProps = {
  projectId: string;
  entityId: string;
};

export function EntityDetail({ projectId, entityId }: EntityDetailProps) {
  const queryClient = useQueryClient();
  const entity = useQuery(entityQuery(projectId, entityId));
  const [outgoing, backlinks] = useQueries({
    queries: [outgoingLinksQuery(projectId, entityId), backlinksQuery(projectId, entityId)]
  });
  const [markdown, setMarkdown] = useState("");

  const documentMarkdown = useMemo(
    () => (entity.data ? entityToMarkdown(entity.data.frontmatter, entity.data.bodyMarkdown) : ""),
    [entity.data]
  );

  useEffect(() => {
    setMarkdown(documentMarkdown);
  }, [documentMarkdown]);

  const mutation = useMutation({
    mutationFn: () => updateEntityMarkdown(projectId, entityId, markdown),
    onSuccess: async (savedEntity) => {
      setMarkdown(entityToMarkdown(savedEntity.frontmatter, savedEntity.bodyMarkdown));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.entity(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.outgoingLinks(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.backlinks(projectId, entityId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      ]);
    }
  });

  if (entity.isLoading) {
    return (
      <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Loading entity...
      </div>
    );
  }

  if (entity.error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {entity.error.message}
      </div>
    );
  }

  if (!entity.data) {
    return null;
  }

  const isDirty = markdown !== documentMarkdown;

  return (
    <div className="grid gap-3">
      <section className="overflow-hidden rounded border border-slate-200 bg-white">
        <div className="flex min-w-0 flex-col gap-3 border-b border-slate-200 p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950">{entity.data.title}</h2>
            <p className="truncate text-xs text-slate-500">
              {entity.data.entityId} / {entity.data.filePath}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
              {entity.data.type}
            </span>
            <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
              {entity.data.status}
            </span>
            <button
              type="button"
              className="button-primary"
              disabled={!isDirty || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              Save
            </button>
          </div>
        </div>
        <MarkdownEditor value={markdown} onChange={setMarkdown} />
      </section>

      {mutation.error ? <p className="text-sm text-red-700">{mutation.error.message}</p> : null}

      <LinkPanels outgoing={outgoing.data ?? []} backlinks={backlinks.data ?? []} />
      <EntityValidation projectId={projectId} entityId={entityId} />
    </div>
  );
}

function EntityValidation({ projectId, entityId }: { projectId: string; entityId: string }) {
  const validation = useQuery(validationMessagesQuery(projectId));
  const messages = (validation.data ?? []).filter((message) => message.entityId === entityId);

  if (messages.length === 0) {
    return null;
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Entity Validation</h3>
      <ul className="grid gap-2">
        {messages.map((message) => (
          <li key={message.id} className="text-sm text-slate-700">
            <span className="font-medium">{message.code}</span>: {message.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function entityToMarkdown(frontmatter: Record<string, unknown>, bodyMarkdown: string) {
  return `---\n${stringifyFrontmatter(frontmatter)}---\n\n${bodyMarkdown}`;
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>) {
  return Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
    .join("\n")
    .concat("\n");
}

function formatYamlValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value ?? {});
}
