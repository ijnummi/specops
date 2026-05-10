import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { CreateEntityRequest } from "@specops/contracts";
import { FilePlus2 } from "lucide-react";

import { createEntity, queryKeys } from "../api/queries.js";

const entityTypes = [
  "use_case",
  "domain_entity",
  "interface",
  "adr",
  "data_model",
  "ui_view",
  "agent_task"
];

export function EntityCreateForm({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<CreateEntityRequest>({
    entityId: "",
    type: "use_case",
    title: "",
    status: "draft"
  });

  const mutation = useMutation({
    mutationFn: () => createEntity(projectId, form),
    onSuccess: async (entity) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.entities(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectOverview(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.validation(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.indexRuns(projectId) })
      ]);
      setForm({ entityId: "", type: "use_case", title: "", status: "draft" });
      setIsOpen(false);
      await navigate({
        to: "/projects/$projectId/entities/$entityId",
        params: { projectId, entityId: entity.entityId },
        search: { q: undefined }
      });
    }
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <section className="border-b border-slate-200 p-3">
      <button
        type="button"
        className="button-secondary w-full justify-center"
        onClick={() => setIsOpen((value) => !value)}
      >
        <FilePlus2 className="h-4 w-4" aria-hidden="true" />
        New Entity
      </button>
      {isOpen ? (
        <form className="mt-3 grid gap-2" onSubmit={handleSubmit}>
          <input
            className="input"
            required
            placeholder="Entity ID"
            value={form.entityId}
            onChange={(event) =>
              setForm((current: CreateEntityRequest) => ({
                ...current,
                entityId: event.target.value
              }))
            }
          />
          <input
            className="input"
            required
            placeholder="Title"
            value={form.title}
            onChange={(event) =>
              setForm((current: CreateEntityRequest) => ({
                ...current,
                title: event.target.value
              }))
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className="input"
              value={form.type}
              onChange={(event) =>
                setForm((current: CreateEntityRequest) => ({
                  ...current,
                  type: event.target.value
                }))
              }
            >
              {entityTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              className="input"
              required
              value={form.status}
              onChange={(event) =>
                setForm((current: CreateEntityRequest) => ({
                  ...current,
                  status: event.target.value
                }))
              }
            />
          </div>
          {mutation.error ? <p className="text-xs text-red-700">{mutation.error.message}</p> : null}
          <button className="button-primary justify-center" type="submit" disabled={mutation.isPending}>
            Create
          </button>
        </form>
      ) : null}
    </section>
  );
}
