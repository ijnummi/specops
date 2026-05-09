import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { createProject, deleteProject, projectsQuery, queryKeys } from "../api/queries.js";
import { ProjectCreateForm } from "../components/project-create-form.js";
import { ProjectCard } from "../components/project-card.js";

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projects = useQuery(projectsQuery());
  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      await navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
        search: { q: undefined }
      });
    }
  });
  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    }
  });

  return (
    <main className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[minmax(360px,430px)_1fr]">
      <section className="min-w-0">
        <div className="mb-3">
          <h1 className="text-base font-semibold">Projects</h1>
          <p className="text-sm text-slate-600">Registered repositories and specops folders.</p>
        </div>
        <ProjectCreateForm
          isSubmitting={createProjectMutation.isPending}
          error={createProjectMutation.error}
          onSubmit={(input) => createProjectMutation.mutate(input)}
        />
      </section>

      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Project Registry</h2>
          <span className="text-xs text-slate-500">{projects.data?.length ?? 0} projects</span>
        </div>

        {deleteProjectMutation.error ? (
          <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {deleteProjectMutation.error.message}
          </div>
        ) : null}

        {projects.isLoading ? (
          <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Loading projects...
          </div>
        ) : projects.error ? (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {projects.error.message}
          </div>
        ) : projects.data && projects.data.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {projects.data.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isDeleting={
                  deleteProjectMutation.isPending && deleteProjectMutation.variables === project.id
                }
                onDelete={(projectToDelete) => deleteProjectMutation.mutate(projectToDelete.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No projects registered.
          </div>
        )}
      </section>
    </main>
  );
}
