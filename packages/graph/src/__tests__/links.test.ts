import { describe, expect, it } from "vitest";

import {
  findBacklinks,
  findBrokenLinks,
  findOrphanEntities,
  findOutgoingLinks,
  type GraphEntity,
  type GraphLink,
} from "../index.js";

describe("graph link helpers", () => {
  const entities: GraphEntity[] = [
    { entityId: "spec:alpha" },
    { entityId: "spec:beta" },
    { entityId: "spec:gamma" },
    { entityId: "spec:orphan" },
  ];

  const links: GraphLink[] = [
    {
      fromEntityId: "spec:alpha",
      toEntityId: "spec:beta",
      linkType: "references",
      source: "markdown",
    },
    {
      fromEntityId: "spec:alpha",
      toEntityId: "spec:missing",
      linkType: "depends-on",
      source: "api",
    },
    {
      fromEntityId: "spec:gamma",
      toEntityId: "spec:alpha",
      linkType: "references",
      source: "db",
    },
  ];

  it("finds outgoing links by entity", () => {
    expect(findOutgoingLinks("spec:alpha", links)).toEqual([
      links[0],
      links[1],
    ]);
  });

  it("finds backlinks by entity", () => {
    expect(findBacklinks("spec:alpha", links)).toEqual([links[2]]);
  });

  it("finds broken links whose target entity is missing", () => {
    expect(findBrokenLinks(entities, links)).toEqual([links[1]]);
  });

  it("finds orphan entities with no incoming or outgoing links", () => {
    expect(findOrphanEntities(entities, links)).toEqual([entities[3]]);
  });
});
