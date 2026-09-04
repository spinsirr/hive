INSERT INTO "github_installations" ("id", "installed_by", "created_at", "updated_at")
SELECT DISTINCT ON ((sessions."repository"->>'installationId')::bigint)
	(sessions."repository"->>'installationId')::bigint,
	members."member_id",
	NOW(),
	NOW()
FROM "task_sessions" sessions
INNER JOIN "task_session_members" members
	ON members."session_id" = sessions."id"
WHERE sessions."repository"->>'provider' = 'github-app'
	AND sessions."repository"->>'installationId' ~ '^[0-9]+$'
	AND (sessions."repository"->>'installationId')::bigint > 0
ORDER BY (sessions."repository"->>'installationId')::bigint, members."joined_at" ASC
ON CONFLICT ("id") DO NOTHING;
