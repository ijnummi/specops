import { mkdir } from "node:fs/promises";

import type { Db } from "@specops/db";
import { initializeSpecopsFolder } from "@specops/markdown";

import {
  assertAbsolutePath,
  assertExistingParentInsideDirectory,
  assertInsideDirectory,
  assertRealPathInsideDirectory
} from "../lib/path-safety.js";
import { createProjectService } from "./project-service.js";

export function createSpecopsInitializerService(db: Db) {
  return {
    async initializeProjectSpecops(projectId: string) {
      const project = await createProjectService(db).getProject(projectId);
      const repoPath = assertAbsolutePath("repoPath", project.repoPath);
      const persistedSpecopsPath = assertAbsolutePath("specopsPath", project.specopsPath);

      assertInsideDirectory(repoPath, persistedSpecopsPath);
      await assertRealPathInsideDirectory(repoPath, repoPath);
      await assertExistingParentInsideDirectory(repoPath, persistedSpecopsPath);
      await mkdir(persistedSpecopsPath, { recursive: true });
      const specopsPath = await assertRealPathInsideDirectory(repoPath, persistedSpecopsPath);

      return initializeSpecopsFolder(specopsPath);
    }
  };
}
