INSERT INTO "github_installations" ("id", "installed_by", "created_at", "updated_at")
SELECT DISTINCT
	("repository"->>'installationId')::bigint,
	"repository"->>'connectedBy',
	NOW(),
	NOW()
FROM "task_sessions"
INNER JOIN "users"
	ON "users"."id" = "task_sessions"."repository"->>'connectedBy'
WHERE "repository"->>'provider' = 'github-app'
	AND "repository"->>'installationId' ~ '^[0-9]+$'
	AND ("repository"->>'installationId')::bigint > 0
ON CONFLICT ("id") DO NOTHING;
