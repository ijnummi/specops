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
    const result = await db.execute<EntitySearchRow>(sql`
      with search_query as (
        select
          (
            websearch_to_tsquery('simple', ${query.q}) ||
            websearch_to_tsquery(
              'simple',
                regexp_replace(${query.q}, '[^[:alnum:]]+', ' ', 'g')
            )
          ) as tsquery
      ),
      entity_vectors as (
        select
          se.entity_id as "entityId",
          se.title,
          se.type,
          se.status,
          se.file_path as "filePath",
          se.body_text,
          to_tsvector(
            'simple',
            coalesce(se.entity_id, '') || ' ' ||
              regexp_replace(coalesce(se.entity_id, ''), '[^[:alnum:]]+', ' ', 'g')
          ) as entity_id_vector,
          to_tsvector('simple', coalesce(se.title, '')) as title_vector,
          to_tsvector('simple', coalesce(se.type, '')) as type_vector,
          to_tsvector('simple', coalesce(se.status, '')) as status_vector,
          to_tsvector('simple', coalesce(se.body_text, '')) as body_text_vector
        from spec_entities se
        where
          se.project_id = ${projectId}
          and (${type}::text is null or se.type = ${type})
          and (${status}::text is null or se.status = ${status})
      ),
      ranked_entities as (
        select
          entity_vectors.*,
          (
            setweight(entity_id_vector, 'A') ||
            setweight(title_vector, 'A') ||
            setweight(type_vector, 'B') ||
            setweight(status_vector, 'B') ||
            setweight(body_text_vector, 'C')
          ) as search_vector,
          search_query.tsquery
        from entity_vectors
        cross join search_query
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
        entity_id_vector @@ tsquery as "entityIdMatched",
        title_vector @@ tsquery as "titleMatched",
        type_vector @@ tsquery as "typeMatched",
        status_vector @@ tsquery as "statusMatched",
        body_text_vector @@ tsquery as "bodyTextMatched"
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
