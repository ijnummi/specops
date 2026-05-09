import path from "node:path";

import type { Db } from "@specops/db";
import { initializeSpecopsFolder } from "@specops/markdown";

import { assertInsideDirectory } from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";

export function createSpecopsInitializerService(db: Db) {
  return {
    async initializeProjectSpecops(projectId: string) {
      const project = await createProjectService(db).getProject(projectId);

      if (path.isAbsolute(project.repoPath) && path.isAbsolute(project.specopsPath)) {
        assertInsideDirectory(project.repoPath, project.specopsPath);
      }

      return initializeSpecopsFolder(project.specopsPath);
    }
  };
}
