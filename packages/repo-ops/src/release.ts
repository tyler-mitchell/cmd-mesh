import { program } from "cmd-mesh"
import { git } from "./git.js"
import { captured, printText, streamed, text } from "./run.js"

const promote = program({
  name: "promote",
  description: "the main → release promotion PR",
  commands: {
    pr: {
      description: "show the open promotion PR",
      safety: "read",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "list", "--head", "main", "--base", "release", "--state", "open", "--limit", "1"])
    },
    create: {
      description: "open the promotion PR",
      safety: "action",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) =>
        captured(ctx, "gh", ["pr", "create", "--head", "main", "--base", "release", "--fill"])
    },
    merge: {
      description: "queue the promotion merge",
      safety: "action",
      output: text,
      cli: { render: printText },
      run: (_input, ctx) => captured(ctx, "gh", ["pr", "merge", "main", "--merge", "--auto"])
    }
  }
})

const review = program({
  name: "review",
  description: "compact Codex review status for the main → release promotion",
  commands: {
    list: {
      description: "list the promotion PR and its unresolved Codex review threads",
      safety: "read",
      input: {
        head: [["string", "@", { description: "PR head branch", cli: "--head" }], "=", "main"]
      },
      output: text,
      cli: { render: printText },
      run: async (input, ctx) => {
        const repository = (await captured(ctx, "gh", [
          "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"
        ])).text
        const [owner, name] = repository.split("/")
        if (owner === undefined || name === undefined) throw new Error(`invalid GitHub repository: ${repository}`)
        const pull = (await captured(ctx, "gh", [
          "pr", "view", input.head, "--json", "number,state,mergeStateStatus,headRefOid,reviews",
          "--jq",
          `{number,state,mergeStateStatus,headRefOid,codexReviews:[.reviews[] | select(.author.login | test("codex"; "i")) | {state,submittedAt}]}`
        ])).text
        const number = `${(JSON.parse(pull) as { readonly number: number }).number}`
        const threads = (await captured(ctx, "gh", [
          "api", "graphql",
          "-f", "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:20){nodes{author{login} body path line url}}}}}}}",
          "-F", `owner=${owner}`,
          "-F", `name=${name}`,
          "-F", `number=${number}`,
          "--jq",
          `.data.repository.pullRequest.reviewThreads.nodes | map(select(.isResolved | not) | . as $thread | .comments.nodes[] | select(.author.login | test("codex"; "i")) | {thread:$thread.id,path,line,title:(.body | split("\\n") | map(select(length > 0)) | .[0] | split("  ") | .[-1])})`
        ])).text
        return { text: JSON.stringify({ pull: JSON.parse(pull), unresolved: JSON.parse(threads) }) }
      }
    },
    resolve: {
      description: "resolve one verified Codex review thread",
      safety: "action",
      input: {
        thread: ["string", "@", { description: "GraphQL review thread ID from release:review", cli: "<thread>" }]
      },
      output: text,
      cli: { render: printText },
      run: (input, ctx) => captured(ctx, "gh", [
        "api", "graphql",
        "-f", "query=mutation($thread:ID!){resolveReviewThread(input:{threadId:$thread}){thread{id isResolved}}}",
        "-F", `thread=${input.thread}`,
        "--jq", ".data.resolveReviewThread.thread"
      ])
    }
  }
})

// the one repository-specific fact the procedure needs is the
// published package name (registry-version), so release is a factory
export const createRelease = (packageName: string) =>
  program({
    name: "release",
    description: "the Bumpy release procedure",
    commands: {
      add: {
        description: "author a bump file (interactive)",
        safety: "action",
        mcp: { hidden: true },
        input: {
          args: [["string[]", "@", { description: "bumpy add arguments", cli: "[...args]" }], "=", () => []]
        },
        run: (input, ctx) => streamed(ctx, "bumpy", ["add", ...input.args])
      },
      check: {
        description: "every changed package has a bump",
        safety: "read",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) => captured(ctx, "bumpy", ["check", "--strict"])
      },
      status: {
        description: "pending bumps and planned versions",
        safety: "read",
        output: text,
        cli: { render: printText },
        // bumpy exits 1 when nothing is pending, with the JSON still on
        // stdout — a report-style exit, not a failure
        run: (_input, ctx) => captured(ctx, "bumpy", ["status", "--json"], [0, 1])
      },
      push: {
        description: "push the daily branch",
        safety: "action",
        output: text,
        cli: { render: printText },
        run: async (_input, ctx) => ({
          text: (await git.push(
            { remote: "origin", branch: "main" },
            { cwd: ctx.workspace.workspaceRootDir() }
          )).trimEnd()
        })
      },
      pr: {
        description: "show the open version PR",
        safety: "read",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) =>
          captured(ctx, "gh", [
            "pr", "list", "--head", "bumpy/version-packages", "--base", "release", "--state", "open", "--limit", "1"
          ])
      },
      merge: {
        description: "queue the version PR squash merge",
        safety: "action",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) =>
          captured(ctx, "gh", ["pr", "merge", "bumpy/version-packages", "--auto", "--squash"])
      },
      update: {
        description: "update the version PR branch",
        safety: "action",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) => captured(ctx, "gh", ["pr", "update-branch", "bumpy/version-packages"])
      },
      "registry-version": {
        description: "published version on npm",
        safety: "read",
        output: text,
        cli: { render: printText },
        run: (_input, ctx) => captured(ctx, "npm", ["view", packageName, "version"])
      },
      sync: {
        description: "synchronize main forward from release",
        safety: "action",
        input: {
          merge: [
            [
              "boolean",
              "@",
              { description: "merge-pull when histories diverged", cli: "--merge" }
            ],
            "=",
            false
          ]
        },
        output: text,
        cli: { render: printText },
        run: async (input, ctx) => ({
          text: (await git.pull(
            {
              ...(input.merge ? { noRebase: true, noEdit: true } : { ffOnly: true }),
              remote: "origin",
              branch: "release"
            },
            { cwd: ctx.workspace.workspaceRootDir() }
          )).trimEnd()
        })
      },
      promote,
      review
    }
  })
