import type { EntitySearchQuery, EntitySearchResultDto } from "@specops/contracts";
import type { Db } from "@specops/db";
import { sql } from "drizzle-orm";

type EntitySearchRow = {
  entityId: string;
  title: string;
  type: string;
  status: string;
  filePath: string;
  rank: string | number;
  snippet: string;
  entityIdMatched: boolean;
  titleMatched: boolean;
  typeMatched: boolean;
  statusMatched: boolean;
  bodyTextMatched: boolean;
};

type MatchedField = EntitySearchResultDto["matchedFields"][number];

export function createEntitySearchService(db: Pick<Db, "execute">) {
  async function searchEntities(
    projectId: string,
    query: EntitySearchQuery
  ): Promise<EntitySearchResultDto[]> {
    const type = query.type ?? null;
    const status = query.status ?? null;
    const pattern = `%${escapeIlikePattern(query.q)}%`;
    const result = await db.execute<EntitySearchRow>(sql`
      with search_query as (
        select
          websearch_to_tsquery('simple', ${query.q}) as tsquery,
          ${pattern}::text as pattern
      ),
      ranked_entities as (
        select
          se.entity_id as "entityId",
          se.title,
          se.type,
          se.status,
          se.file_path as "filePath",
          se.body_text,
          (
            setweight(
              to_tsvector(
                'simple',
                coalesce(se.entity_id, '') || ' ' ||
                  regexp_replace(coalesce(se.entity_id, ''), '[^[:alnum:]]+', ' ', 'g')
              ),
              'A'
            ) ||
            setweight(to_tsvector('simple', coalesce(se.title, '')), 'A') ||
            setweight(to_tsvector('simple', coalesce(se.type, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(se.status, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(se.body_text, '')), 'C')
          ) as search_vector,
          search_query.tsquery,
          search_query.pattern
        from spec_entities se
        cross join search_query
        where
          se.project_id = ${projectId}
          and (${type}::text is null or se.type = ${type})
          and (${status}::text is null or se.status = ${status})
      )
      select
        "entityId",
        title,
        type,
        status,
        "filePath",
        ts_rank_cd(search_vector, tsquery) as rank,
        ts_headline(
          'simple',
          body_text,
          tsquery,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5'
        ) as snippet,
        "entityId" ilike pattern escape ${"\\"} as "entityIdMatched",
        title ilike pattern escape ${"\\"} as "titleMatched",
        type ilike pattern escape ${"\\"} as "typeMatched",
        status ilike pattern escape ${"\\"} as "statusMatched",
        body_text ilike pattern escape ${"\\"} as "bodyTextMatched"
      from ranked_entities
      where search_vector @@ tsquery
      order by rank desc, "entityId" asc
      limit ${query.limit}
    `);

    return result.rows.map(mapSearchRow);
  }

  return { searchEntities };
}

function mapSearchRow(row: EntitySearchRow): EntitySearchResultDto {
  return {
    entityId: row.entityId,
    title: row.title,
    type: row.type,
    status: row.status,
    filePath: row.filePath,
    rank: Number(row.rank),
    snippet: row.snippet,
    matchedFields: getMatchedFields(row)
  };
}

function getMatchedFields(row: EntitySearchRow): MatchedField[] {
  const fields: Array<[MatchedField, boolean]> = [
    ["entityId", row.entityIdMatched],
    ["title", row.titleMatched],
    ["type", row.typeMatched],
    ["status", row.statusMatched],
    ["bodyText", row.bodyTextMatched]
  ];

  return fields.filter(([, matched]) => matched).map(([field]) => field);
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
