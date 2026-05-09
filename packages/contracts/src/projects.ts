import { z } from "zod";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  repoPath: z.string(),
  specopsPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const createProjectRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().optional(),
  repoPath: z.string().min(1),
  specopsPath: z.string().min(1)
});

export const updateProjectRequestSchema = createProjectRequestSchema.partial();

export type ProjectDto = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
