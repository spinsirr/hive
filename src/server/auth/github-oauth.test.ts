import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { registerTestModules } from "../../../tests/helpers/test-modules.mjs";

registerTestModules();
const {
  exchangeGitHubOAuthCode,
  getGitHubUser,
  GitHubUserAuthorizationError,
  listGitHubUserRepositories,
} = await import("./github-oauth.ts");

test("GitHub SDK preserves authentication and repository discovery boundaries", async (t) => {
  const configuration = {
    GITHUB_APP_CLIENT_ID: "fixture-client",
    GITHUB_APP_CLIENT_SECRET: "PRIVATE_CLIENT_SECRET",
    GITHUB_APP_CALLBACK_URL: "https://hive.test/api/github/callback",
  };
  const previous = new Map(
    Object.keys(configuration).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, configuration);
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unmatched GitHub fixture request");
  });
  try {
    await t.test(
      "OAuth exchange retains the callback and token expiry without caching",
      async (t) => {
        const requests = t.mock.method(
          globalThis,
          "fetch",
          async (input: RequestInfo | URL, init?: RequestInit) => {
            assert.ok(init);
            assert.equal(
              String(input),
              "https://github.com/login/oauth/access_token"
            );
            assert.equal(init.method, "POST");
            assert.equal(init.cache, "no-store");
            assert.deepEqual(JSON.parse(String(init.body)), {
              client_id: configuration.GITHUB_APP_CLIENT_ID,
              client_secret: configuration.GITHUB_APP_CLIENT_SECRET,
              code: "PRIVATE_CODE",
              redirect_uri: configuration.GITHUB_APP_CALLBACK_URL,
            });
            return Response.json(
              {
                access_token: "PRIVATE_USER_TOKEN",
                scope: "",
                token_type: "bearer",
                expires_in: 300,
                refresh_token: "PRIVATE_REFRESH_TOKEN",
                refresh_token_expires_in: 3600,
              },
              { headers: { Date: new Date().toUTCString() } }
            );
          }
        );
        const result = await exchangeGitHubOAuthCode("PRIVATE_CODE");
        assert.equal(result.accessToken, "PRIVATE_USER_TOKEN");
        assert.ok(
          result.expiresIn && result.expiresIn > 298 && result.expiresIn <= 300
        );
        assert.equal("refreshToken" in result, false);
        assert.equal(requests.mock.callCount(), 1);
      }
    );

    await t.test(
      "rejected or malformed exchanges expose no SDK credentials and are not replayed",
      async (t) => {
        const responses = [
          Response.json({
            error: "bad_verification_code",
            error_description: "PRIVATE_CODE",
          }),
          Response.json({ message: "PRIVATE_CLIENT_SECRET" }, { status: 503 }),
          Response.json({ token_type: "bearer" }),
        ];
        const requests = t.mock.method(globalThis, "fetch", async () =>
          responses.shift()!
        );
        for (let attempt = 0; attempt < 3; attempt++) {
          await assert.rejects(
            exchangeGitHubOAuthCode("PRIVATE_CODE"),
            (error: unknown) => {
              assert.ok(error instanceof Error);
              assert.equal(
                error.message,
                "GitHub rejected the OAuth authorization code."
              );
              assert.doesNotMatch(inspect(error), /PRIVATE_|request:|cause:/);
              return true;
            }
          );
          assert.equal(requests.mock.callCount(), attempt + 1);
        }
      }
    );

    await t.test(
      "installation and repository pages follow GitHub links using only the user's token",
      async (t) => {
        const base = "https://api.github.com";
        const repository = (id: number, name: string) => ({
          id,
          full_name: name,
          clone_url: `https://github.com/${name}.git`,
          default_branch: "main",
          private: true,
        });
        const page = (body: object, next?: string) =>
          Response.json(body, {
            headers: next ? { Link: `<${base}${next}>; rel="next"` } : {},
          });
        const pages = new Map([
          [
            "/user/installations?per_page=100",
            page(
              { total_count: 2, installations: [{ id: 21 }] },
              "/user/installations?per_page=100&page=2"
            ),
          ],
          [
            "/user/installations?per_page=100&page=2",
            page({ total_count: 2, installations: [{ id: 22 }] }),
          ],
          [
            "/user/installations/21/repositories?per_page=100",
            page(
              { total_count: 2, repositories: [repository(101, "team/zebra")] },
              "/user/installations/21/repositories?per_page=100&page=2"
            ),
          ],
          [
            "/user/installations/21/repositories?per_page=100&page=2",
            page({
              total_count: 2,
              repositories: [repository(102, "team/alpha")],
            }),
          ],
          [
            "/user/installations/22/repositories?per_page=100",
            page({
              total_count: 1,
              repositories: [repository(103, "team/middle")],
            }),
          ],
        ]);
        const requests = t.mock.method(
          globalThis,
          "fetch",
          async (input: RequestInfo | URL, init?: RequestInit) => {
            assert.ok(init);
            const url = new URL(String(input));
            assert.equal(url.origin, base);
            assert.equal(init.cache, "no-store");
            const headers = new Headers(init.headers);
            assert.equal(
              headers.get("authorization"),
              "token PRIVATE_USER_TOKEN"
            );
            assert.equal(headers.get("x-github-api-version"), "2026-03-10");
            const key = `${url.pathname}${url.search}`;
            const response = pages.get(key);
            assert.ok(
              response,
              "Only account-scoped repository endpoints are allowed"
            );
            pages.delete(key);
            Object.defineProperty(response, "url", { value: String(input) });
            return response;
          }
        );
        const repositories =
          await listGitHubUserRepositories("PRIVATE_USER_TOKEN");
        assert.deepEqual(
          repositories.map(({ id, installationId, name }) => ({
            id,
            installationId,
            name,
          })),
          [
            { id: 102, installationId: 21, name: "team/alpha" },
            { id: 103, installationId: 22, name: "team/middle" },
            { id: 101, installationId: 21, name: "team/zebra" },
          ]
        );
        assert.equal(requests.mock.callCount(), 5);
        assert.equal(pages.size, 0);
      }
    );

    await t.test(
      "an expired or revoked page rejects the entire list without retry or partial results",
      async (t) => {
        for (const status of [401, 403, 429, 503]) {
          const requests = t.mock.method(
            globalThis,
            "fetch",
            async (input: RequestInfo | URL) => {
              const response =
                new URL(String(input)).pathname === "/user/installations"
                  ? Response.json({
                      total_count: 1,
                      installations: [{ id: 21 }],
                    })
                  : Response.json(
                      { message: "PRIVATE_USER_TOKEN" },
                      { status }
                    );
              Object.defineProperty(response, "url", { value: String(input) });
              return response;
            }
          );
          await assert.rejects(
            listGitHubUserRepositories("PRIVATE_USER_TOKEN"),
            (error: unknown) => {
              assert.ok(error instanceof Error);
              assert.equal(
                error instanceof GitHubUserAuthorizationError,
                status === 401
              );
              assert.doesNotMatch(inspect(error), /PRIVATE_|request:|cause:/);
              return true;
            }
          );
          assert.equal(requests.mock.callCount(), 2);
          requests.mock.restore();
        }
      }
    );

    await t.test(
      "SDK IDs must fit Hive's storage without rounding",
      async (t) => {
        t.mock.method(
          globalThis,
          "fetch",
          async () =>
            new Response(
              '{"id":9007199254740993,"login":"fixture","name":"Fixture","avatar_url":null}',
              { headers: { "Content-Type": "application/json" } }
            )
        );
        await assert.rejects(getGitHubUser("PRIVATE_USER_TOKEN"), /Too big/);
      }
    );
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
