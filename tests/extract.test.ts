import { describe, it, expect } from "vitest";
import { clientRedirect } from "../src/server/extract.ts";

const base = "https://open.substack.com/pub/x/p/post?r=1&utm_medium=ios";
// The shape of the page Substack's share links answer with (shortened).
const stub = `<head><noscript><META http-equiv="refresh" content="0;URL=https://x.substack.com/p/post?r=1&#38;utm_medium=ios&#38;triedRedirect=true"></noscript><title>x</title></head><script>window.opener = null; location.replace("https://x.substack.com/p/post?r=1&utm_medium=ios&triedRedirect=true")</script>`;

describe("share links that only send you on to the real page", () => {
  it("follows a meta refresh", () => {
    expect(clientRedirect(`<meta http-equiv="refresh" content="0; url=/real">`, "https://a.com/stub")).toBe("https://a.com/real");
  });
  it("follows a one-line script redirect, as Substack's open. links use", () => {
    expect(clientRedirect(`<script>location.replace("https://x.substack.com/p/post")</script>`, base)).toBe("https://x.substack.com/p/post");
  });
  it("reads Substack's real stub page", () => {
    expect(clientRedirect(stub, base)).toBe("https://x.substack.com/p/post?r=1&utm_medium=ios&triedRedirect=true");
  });
  it("never treats a real, long article as a redirect page", () => {
    expect(clientRedirect(`<p>${"words ".repeat(2000)}</p><script>location.replace("https://evil.example/")</script>`, base)).toBeNull();
  });
  it("ignores pages that don't redirect, redirects to itself, and non-web targets", () => {
    expect(clientRedirect("<p>hello</p>", base)).toBeNull();
    expect(clientRedirect(`<script>location.replace("${base}")</script>`, base)).toBeNull();
    expect(clientRedirect(`<script>location.href = "javascript:alert(1)"</script>`, base)).toBeNull();
  });
});
