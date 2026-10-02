import { describe, expect, it } from "vitest";
import {
  type WorkflowRun,
  duration,
  lightOf,
  parseGitHubUrl,
  pickGitHubRemote,
  statusByCommit,
  worst,
} from "../src/extensions/github-actions/model";

const run = (p: Partial<WorkflowRun>): WorkflowRun => ({
  id: 1,
  name: "CI",
  display_title: "t",
  run_number: 1,
  workflow_id: 10,
  head_branch: "main",
  head_sha: "aaa",
  event: "push",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/o/r/actions/runs/1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:01:00Z",
  ...p,
});

describe("GitHub Actions: remotes", () => {
  it.each([
    ["git@github.com:acme/widgets.git", "acme", "widgets"],
    ["git@github.com:acme/widgets", "acme", "widgets"],
    ["https://github.com/acme/widgets.git", "acme", "widgets"],
    ["https://github.com/acme/widgets/", "acme", "widgets"],
    ["https://user:tok@github.com/acme/my.repo.git", "acme", "my.repo"],
    ["ssh://git@github.com/acme/widgets.git", "acme", "widgets"],
    ["ssh://git@github.com:22/acme/widgets.git", "acme", "widgets"],
    ["git://github.com/acme/widgets.git", "acme", "widgets"],
  ])("%s", (url, owner, repo) => {
    expect(parseGitHubUrl(url)).toEqual({ owner, repo });
  });

  it("ignora o que não é github.com", () => {
    expect(parseGitHubUrl("git@gitlab.com:acme/widgets.git")).toBeNull();
    expect(parseGitHubUrl("https://github.com.evil.io/acme/widgets")).toBeNull();
    expect(parseGitHubUrl("https://github.com/acme")).toBeNull();
    expect(parseGitHubUrl("/srv/git/widgets.git")).toBeNull();
  });

  it("prefere origin, depois upstream, depois o primeiro do GitHub", () => {
    const cfg = (lines: string[]) => lines.join("\n") + "\n";
    expect(
      pickGitHubRemote(
        cfg(["remote.fork.url git@github.com:me/w.git", "remote.upstream.url git@github.com:acme/w.git", "remote.origin.url https://github.com/o/w"]),
      ),
    ).toEqual({ owner: "o", repo: "w" });
    expect(pickGitHubRemote(cfg(["remote.fork.url git@github.com:me/w.git", "remote.upstream.url git@github.com:acme/w.git"]))).toEqual({
      owner: "acme",
      repo: "w",
    });
    expect(pickGitHubRemote(cfg(["remote.origin.url git@gitlab.com:x/y.git", "remote.gh.url git@github.com:me/w.git"]))).toEqual({
      owner: "me",
      repo: "w",
    });
    expect(pickGitHubRemote("")).toBeNull();
  });
});

describe("GitHub Actions: status", () => {
  it("traduz status/conclusão", () => {
    expect(lightOf({ status: "in_progress", conclusion: null })).toBe("pending");
    expect(lightOf({ status: "completed", conclusion: "timed_out" })).toBe("failure");
    expect(lightOf({ status: "completed", conclusion: "cancelled" })).toBe("cancelled");
    expect(lightOf({ status: "completed", conclusion: "skipped" })).toBe("neutral");
    expect(worst(["success", "failure", "neutral"])).toBe("failure");
    expect(worst(["success", "pending", "failure"])).toBe("pending");
    expect(worst([])).toBeNull();
  });

  it("usa só a execução mais recente de cada workflow por commit", () => {
    const m = statusByCommit([
      run({ id: 1, head_sha: "aaa", workflow_id: 10, conclusion: "failure" }),
      run({ id: 2, head_sha: "aaa", workflow_id: 10, conclusion: "success" }), // re-run passou
      run({ id: 3, head_sha: "aaa", workflow_id: 11, conclusion: "success" }),
      run({ id: 4, head_sha: "bbb", workflow_id: 10, conclusion: "success" }),
      run({ id: 5, head_sha: "bbb", workflow_id: 11, status: "in_progress", conclusion: null }),
      run({ id: 6, head_sha: "ccc", run_attempt: 1, conclusion: "success" }),
      run({ id: 6, head_sha: "ccc", run_attempt: 2, conclusion: "failure" }),
    ]);
    expect(m.get("aaa")).toBe("success");
    expect(m.get("bbb")).toBe("pending");
    expect(m.get("ccc")).toBe("failure");
  });

  it("formata durações", () => {
    expect(duration("2026-01-01T00:00:00Z", "2026-01-01T00:00:42Z")).toBe("42s");
    expect(duration("2026-01-01T00:00:00Z", "2026-01-01T00:03:05Z")).toBe("3m 5s");
    expect(duration("2026-01-01T00:00:00Z", "2026-01-01T02:10:00Z")).toBe("2h 10m");
    expect(duration(null)).toBe("");
  });
});
