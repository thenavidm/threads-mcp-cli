import { describe, expect, it } from "vitest";
import { getAccountInsights, getTopPosts } from "../src/tools/insights.js";
import { getPost } from "../src/tools/read.js";

type Call = { path: string; params: Record<string, unknown> };

/** A context whose client answers from a function, and keeps every call it was asked to make. */
function fakeContext(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = {
    userId: async () => "1",
    call: async (_account: unknown, path: string, init: { params?: Record<string, unknown> } = {}) => {
      const call = { path, params: init.params ?? {} };
      calls.push(call);
      const out = answer(call);
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { calls, ctx: { client, config: {}, account: () => ({ username: "me" }) } as never };
}

const run = (tool: unknown, args: Record<string, unknown>, ctx: never) =>
  (tool as { handler: (a: Record<string, unknown>, c: never) => Promise<Record<string, unknown>> }).handler(args, ctx);

describe("profile insights", () => {
  it("reads link clicks from their own envelope, with the split by link", async () => {
    const { ctx } = fakeContext(() => ({
      data: [
        { name: "likes", total_value: { value: 7 } },
        { name: "clicks", link_total_values: [{ value: 11, link_url: "https://a.example" }, { value: 4, link_url: "https://b.example" }] },
      ],
    }));
    const out = await run(getAccountInsights, { metrics: ["likes", "clicks"] }, ctx);
    expect(out.clicks).toBe(15);
    expect(out.clicks_by_link).toEqual([
      { url: "https://a.example", clicks: 11 },
      { url: "https://b.example", clicks: 4 },
    ]);
  });

  it("says Meta's default window, yesterday through today, when no range was given", async () => {
    const { ctx } = fakeContext(() => ({ data: [{ name: "likes", total_value: { value: 1 } }] }));
    const out = await run(getAccountInsights, { metrics: ["likes"] }, ctx);
    expect(out.window).toBe("yesterday through today, Meta's default");
    expect(JSON.stringify(out)).not.toContain("lifetime");
  });
});

describe("top posts", () => {
  it("leaves a number Meta did not return as null, never 0, and lists those posts last", async () => {
    const { ctx } = fakeContext(({ path }) => {
      if (path === "/1/threads") return { data: [{ id: "10", text: "no views reported" }, { id: "20", text: "full numbers" }] };
      if (path === "/10/insights") return { data: [{ name: "likes", total_value: { value: 3 } }] };
      return {
        data: [
          { name: "views", values: [{ value: 100 }] },
          { name: "likes", total_value: { value: 5 } },
          { name: "replies", total_value: { value: 1 } },
          { name: "reposts", total_value: { value: 0 } },
          { name: "quotes", total_value: { value: 0 } },
        ],
      };
    });
    const out = await run(getTopPosts, {}, ctx);
    const posts = out.posts as Array<Record<string, unknown>>;
    expect(posts.map((p) => p.id)).toEqual(["20", "10"]);
    expect(posts[0].engagement_rate).toBe(6);
    expect(posts[1].views).toBeNull();
    expect(posts[1].engagement_rate).toBeNull();
    expect(posts[1].likes).toBe(3);
    expect(String(out.note)).toMatch(/null/);
  });
});

describe("reading one post", () => {
  it("adds what a reply replies to, asked for apart from the post's fields", async () => {
    const { ctx, calls } = fakeContext(({ params }) =>
      String(params.fields).startsWith("is_reply")
        ? { is_reply: true, replied_to: { id: "900" }, root_post: { id: "800" } }
        : { id: "17890000000000901", text: "A reply." },
    );
    const out = String(await run(getPost, { id: "17890000000000901" }, ctx));
    expect(out).toContain('replied_to="900"');
    expect(out).toContain('root_post="800"');
    expect(out).toContain('type="reply"');
    expect(calls).toHaveLength(2);
    expect(String(calls[0].params.fields)).not.toContain("replied_to");
  });

  it("still returns the post when Threads refuses the reply fields", async () => {
    const { ctx } = fakeContext(({ params }) =>
      String(params.fields).startsWith("is_reply") ? new Error("nonexisting field") : { id: "17890000000000902", text: "A post." },
    );
    const out = String(await run(getPost, { id: "17890000000000902" }, ctx));
    expect(out).toContain('id="17890000000000902"');
    expect(out).not.toContain("replied_to");
  });

  it("shows a text attachment exactly, with its link", async () => {
    const { ctx } = fakeContext(({ params }) =>
      String(params.fields).startsWith("is_reply")
        ? {}
        : { id: "17890000000000903", text: "Short.", text_attachment: { plaintext: "The long part.\nLine two.", link_attachment_url: "https://a.example" } },
    );
    const out = String(await run(getPost, { id: "17890000000000903" }, ctx));
    expect(out).toContain('<attachment link="https://a.example">\nThe long part.\nLine two.\n');
  });
});
