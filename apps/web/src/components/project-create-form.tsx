import { FormEvent, useState } from "react";
import type { CreateProjectRequest } from "@specops/contracts";
import { Plus } from "lucide-react";

type ProjectCreateFormProps = {
  isSubmitting: boolean;
  error: Error | null;
  onSubmit: (input: CreateProjectRequest) => void;
};

export function ProjectCreateForm({ isSubmitting, error, onSubmit }: ProjectCreateFormProps) {
  const [form, setForm] = useState<CreateProjectRequest>({
    name: "",
    slug: "",
    repoPath: "",
    specopsPath: "",
    description: ""
  });

  function updateField<K extends keyof CreateProjectRequest>(
    key: K,
    value: CreateProjectRequest[K]
  ) {
    setForm((current: CreateProjectRequest) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const repoPath = form.repoPath.trim();
    onSubmit({
      ...form,
      repoPath,
      specopsPath: (form.specopsPath ?? "").trim() || defaultSpecopsPathForRepoInput(repoPath),
      description: form.description?.trim() || undefined
    });
  }

  return (
    <form className="rounded border border-slate-200 bg-white p-4" onSubmit={handleSubmit}>
      <div className="grid gap-3">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            required
            value={form.name}
            onChange={(event) => {
              updateField("name", event.target.value);
              if (!form.slug) {
                updateField("slug", slugify(event.target.value));
              }
            }}
          />
        </label>
        <label className="field">
          <span>Slug</span>
          <input
            className="input"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={form.slug}
            onChange={(event) => updateField("slug", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Repository Path</span>
          <input
            className="input"
            required
            value={form.repoPath}
            onChange={(event) => {
              const nextRepoPath = event.target.value;
              const previousDefault = defaultSpecopsPathForRepoInput(form.repoPath);
              updateField("repoPath", nextRepoPath);
              if (!form.specopsPath || form.specopsPath === previousDefault) {
                updateField("specopsPath", defaultSpecopsPathForRepoInput(nextRepoPath));
              }
            }}
          />
        </label>
        <label className="field">
          <span>SpecOps Path</span>
          <input
            className="input"
            required
            value={form.specopsPath ?? ""}
            onChange={(event) => updateField("specopsPath", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            className="input min-h-20 resize-y"
            value={form.description ?? ""}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error.message}</p> : null}
        <button className="button-primary justify-center" type="submit" disabled={isSubmitting}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create Project
        </button>
      </div>
    </form>
  );
}

export function defaultSpecopsPathForRepoInput(repoPath: string) {
  const trimmed = repoPath.trim();
  return trimmed ? `${trimmed.replace(/[\\/]+$/, "")}/specops` : "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
