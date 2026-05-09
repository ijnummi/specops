import { mkdir } from "node:fs/promises";

import type { Db } from "@specops/db";
import { initializeSpecopsFolder } from "@specops/markdown";

import {
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";

export function createSpecopsInitializerService(db: Db) {
  return {
    async initializeProjectSpecops(projectId: string) {
      const project = await createProjectService(db).getProject(projectId);

      assertInsideDirectory(project.repoPath, project.specopsPath);
      await assertRealPathInsideDirectory(project.repoPath, project.repoPath);
      await assertExistingParentInsideDirectory(project.repoPath, project.specopsPath);
      await mkdir(project.specopsPath, { recursive: true });
      const specopsPath = await assertRealPathInsideDirectory(project.repoPath, project.specopsPath);

      return initializeSpecopsFolder(specopsPath);
    }
  };
}
