import { describe, expect, it } from "vitest";

import {
  fetchInstagramPost,
  isInstagramHost,
  parseInstagramEmbedHtml,
  parseInstagramUrl,
  unescapeOnce,
} from "../src/lib/instagram";

/**
 * 인스타 embed 페이지는 JSON을 JS 문자열로 두 번 이스케이프해 넣습니다.
 * 실제 응답에서 관찰한 모양(\\\" , \\\\/ )을 그대로 흉내 낸 픽스처입니다.
 */
function embedHtml(media: Record<string, unknown>): string {
  const context = JSON.stringify({ context: { type: "GraphVideo" }, gql_data: { shortcode_media: media } });
  const twiceEscaped = JSON.stringify(JSON.stringify(context))
    // 실제 페이지처럼 슬래시까지 이스케이프합니다.
    .replace(/\//g, "\\\\\\/")
    .slice(1, -1);
  return `<html><head><title>Instagram</title></head><body><script>requireLazy(["x"],function(){var x={
    "contextJSON":"${twiceEscaped}"
  };})</script></body></html>`;
}

const MEDIA = {
  __typename: "GraphVideo",
  id: "3540263417529623371",
  shortcode: "DEhitI1KeNL",
  is_video: true,
  video_url: "https://scontent-sea5-2.cdninstagram.com/v/t2/clip.mp4",
  display_url: "https://scontent-sea5-2.cdninstagram.com/v/t51/poster.jpg",
  owner: { username: "uflgame", full_name: "UFL" },
  edge_media_to_caption: {
    edges: [{ node: { text: "릴스를 만들 때 첫 3초에 결론을 던지세요.\n\n#릴스 #영상제작" } }],
  },
  edge_liked_by: { count: 1585989 },
};

describe("parseInstagramUrl", () => {
  it("reads /p/, /reel/, /reels/, /tv/ and share links", () => {
    expect(parseInstagramUrl("https://www.instagram.com/p/DEhitI1KeNL/")?.shortcode).toBe("DEhitI1KeNL");
    expect(parseInstagramUrl("https://www.instagram.com/reel/Deqy8qETL5K/?igsh=abc")?.shortcode).toBe("Deqy8qETL5K");
    expect(parseInstagramUrl("https://instagram.com/reels/DIvimWSse4j")?.shortcode).toBe("DIvimWSse4j");
    expect(parseInstagramUrl("https://www.instagram.com/tv/CabcDEF123/")?.shortcode).toBe("CabcDEF123");
    expect(parseInstagramUrl("instagram.com/p/CabcDEF123/")?.url).toBe("https://www.instagram.com/p/CabcDEF123/");
    expect(parseInstagramUrl("https://www.instagram.com/someone/p/CabcDEF123/")?.shortcode).toBe("CabcDEF123");
  });

  it("rejects other hosts and profile-only links", () => {
    expect(parseInstagramUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseInstagramUrl("https://www.instagram.com/uflgame/")).toBeNull();
    expect(parseInstagramUrl("not a url")).toBeNull();
  });

  it("keeps app share links as tokens to resolve (token is not a shortcode)", () => {
    const reel = parseInstagramUrl("https://www.instagram.com/share/reel/_o22CKDyw/?igsh=abc");
    expect(reel?.shortcode).toBeNull();
    expect(reel?.shareToken).toBe("_o22CKDyw");
    expect(reel?.shareKind).toBe("reel");

    const bare = parseInstagramUrl("https://www.instagram.com/share/_o22CKDyw");
    expect(bare?.shortcode).toBeNull();
    expect(bare?.shareToken).toBe("_o22CKDyw");

    const post = parseInstagramUrl("instagram.com/share/p/BARSSL4rTu/");
    expect(post?.shareToken).toBe("BARSSL4rTu");
    expect(post?.shareKind).toBe("p");
  });

  it("detects instagram hosts including subdomains", () => {
    expect(isInstagramHost("https://www.instagram.com/p/x/")).toBe(true);
    expect(isInstagramHost("https://www.instagram.com")).toBe(true);
    expect(isInstagramHost("https://instagram.com.evil.test/p/x/")).toBe(false);
    expect(isInstagramHost("https://youtube.com")).toBe(false);
  });
});

describe("parseInstagramEmbedHtml", () => {
  it("pulls caption, author, photos and the reel video url", () => {
    const post = parseInstagramEmbedHtml(embedHtml(MEDIA));
    expect(post).not.toBeNull();
    expect(post?.caption).toContain("첫 3초에 결론");
    expect(post?.author).toBe("@uflgame");
    expect(post?.title).toBe("릴스를 만들 때 첫 3초에 결론을 던지세요.");
    expect(post?.images[0]).toContain("poster.jpg");
    expect(post?.videoUrl).toContain("clip.mp4");
    expect(post?.isVideo).toBe(true);
    expect(post?.likes).toBe(1585989);
    expect(post?.source).toBe("embed");
  });

  it("collects carousel photos in order", () => {
    const post = parseInstagramEmbedHtml(
      embedHtml({
        ...MEDIA,
        __typename: "GraphSidecar",
        is_video: false,
        video_url: undefined,
        edge_sidecar_to_children: {
          edges: [
            { node: { display_url: "https://scontent.cdninstagram.com/a.jpg" } },
            { node: { display_url: "https://scontent.cdninstagram.com/b.jpg" } },
          ],
        },
      }),
    );
    expect(post?.images).toEqual([
      "https://scontent-sea5-2.cdninstagram.com/v/t51/poster.jpg",
      "https://scontent.cdninstagram.com/a.jpg",
      "https://scontent.cdninstagram.com/b.jpg",
    ]);
    expect(post?.videoUrl).toBeNull();
  });

  it("falls back to og tags when the embed JSON is missing (login wall)", () => {
    const html = `<html><head>
      <meta property="og:title" content="카드뉴스 만드는 법 on Instagram" />
      <meta property="og:description" content="1,234 likes - 카드뉴스는 한 장에 주장 하나씩 담아야 읽힙니다. 순서를 바꾸면 같은 내용도 새로 읽힙니다." />
      <meta property="og:image" content="https://scontent.cdninstagram.com/preview.jpg" />
    </head><body></body></html>`;
    const post = parseInstagramEmbedHtml(html);
    expect(post?.source).toBe("page_meta");
    expect(post?.caption).toContain("한 장에 주장 하나");
    expect(post?.images).toEqual(["https://scontent.cdninstagram.com/preview.jpg"]);
  });

  it("strips the like/comment/handle prefix from the og description", () => {
    const html = `<html><head>
      <meta property="og:title" content="정은ᰔᩚ(이찬맘) on Instagram: &quot;#협찬 #쁘띠앤서포터즈 | 락토프리미엄\n요즘 우리가족 장 건강을 위해 챙겨먹기 시작했어요&quot;" />
      <meta property="og:description" content="326 likes, 11 comments - chan_ddangddang on November 20, 2026: &quot;#협찬 #쁘띠앤서포터즈 | 락토프리미엄\n요즘 우리가족 장 건강을 위해 챙겨먹기 시작했어요&quot;" />
      <meta property="og:image" content="https://scontent.cdninstagram.com/p.jpg" />
    </head><body></body></html>`;
    const post = parseInstagramEmbedHtml(html);
    expect(post?.caption.startsWith("#협찬")).toBe(true);
    expect(post?.caption).not.toContain("326 likes");
    expect(post?.caption).not.toContain("chan_ddangddang on");
    expect(post?.author).toBe("@chan_ddangddang");
    expect(post?.authorName).toBe("정은ᰔᩚ(이찬맘)");
  });

  it("returns null for an empty or unrelated page", () => {
    expect(parseInstagramEmbedHtml("<html><body>login</body></html>")).toBeNull();
  });

  it("unescapes JSON one level at a time", () => {
    expect(unescapeOnce('a\\"b')).toBe('a"b');
    expect(unescapeOnce("\\u0040uflgame")).toBe("@uflgame");
    expect(unescapeOnce("a\\\\nb")).toBe("a\\nb");
  });
});

describe("fetchInstagramPost", () => {
  it("tries the embed endpoint first and returns the parsed post", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/embed/captioned/")) {
        return new Response(embedHtml(MEDIA), { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("<html></html>", { status: 404 });
    }) as typeof fetch;

    const result = await fetchInstagramPost("https://www.instagram.com/reel/DEhitI1KeNL/", fetchImpl);
    expect(result.post?.author).toBe("@uflgame");
    expect(result.reason).toBeNull();
    expect(calls[0]).toContain("https://www.instagram.com/p/DEhitI1KeNL/embed/captioned/");
    expect(result.attempts.length).toBeGreaterThan(0);
  });

  it("reports not_found when every path returns nothing usable", async () => {
    const fetchImpl = (async () => new Response("<html><body>Page Not Found</body></html>", { status: 200 })) as typeof fetch;
    const result = await fetchInstagramPost("https://www.instagram.com/p/C0XhLqWr6bH/", fetchImpl);
    expect(result.post).toBeNull();
    expect(result.reason).toBe("not_found");
  });

  it("flags a login wall when the page asks for login", async () => {
    const fetchImpl = (async () =>
      new Response('<html><script>window._sharedData = {"entry_data":{"LoginAndSignupPage":{}}}</script>login</html>', {
        status: 200,
      })) as typeof fetch;
    const result = await fetchInstagramPost("https://www.instagram.com/p/C0XhLqWr6bH/", fetchImpl);
    expect(result.reason).toBe("login_required");
  });

  it("ignores non-instagram URLs", async () => {
    const result = await fetchInstagramPost("https://blog.example.com/post/1");
    expect(result.reason).toBe("invalid_url");
  });

  it("follows a /share/ link to the real post before reading it", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/share/reel/")) {
        const response = new Response("<html><body>app</body></html>", { status: 200 });
        // 실제 인스타는 302로 /reel/{code}/ 로 보냅니다(최종 주소가 응답 url에 담깁니다).
        Object.defineProperty(response, "url", { value: "https://www.instagram.com/reel/DEhitI1KeNL/?igsh=abc" });
        return response;
      }
      if (url.includes("/embed/captioned/")) {
        return new Response(embedHtml(MEDIA), { status: 200 });
      }
      return new Response("<html></html>", { status: 404 });
    }) as typeof fetch;

    const result = await fetchInstagramPost("https://www.instagram.com/share/reel/_o22CKDyw/", fetchImpl);
    expect(result.post?.author).toBe("@uflgame");
    expect(result.shortcode).toBe("DEhitI1KeNL");
    expect(calls[0]).toContain("/share/reel/_o22CKDyw");
    expect(result.attempts[0]).toContain("공유 링크 해석");
  });

  it("uses oEmbed when the embed page has no post JSON", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oembed")) {
        return new Response(
          JSON.stringify({
            title: "카드뉴스는 한 장에 주장 하나씩 담아야 읽힙니다.",
            author_name: "cardnews",
            thumbnail_url: "https://scontent.cdninstagram.com/preview.jpg",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("<html><body>shell</body></html>", { status: 200 });
    }) as typeof fetch;

    const result = await fetchInstagramPost("https://www.instagram.com/reel/DEhitI1KeNL/", fetchImpl);
    expect(result.post?.source).toBe("oembed");
    expect(result.post?.author).toBe("@cardnews");
    expect(result.post?.caption).toContain("한 장에 주장 하나");
    expect(result.post?.images).toEqual(["https://scontent.cdninstagram.com/preview.jpg"]);
  });

  it("tells private and age-restricted posts apart from missing ones", async () => {
    const respond = (body: string, status: number) =>
      (async (input: RequestInfo | URL) => {
        if (String(input).includes("oembed")) return new Response(body, { status });
        return new Response("<html><body>shell</body></html>", { status: 200 });
      }) as typeof fetch;

    const priv = await fetchInstagramPost("https://www.instagram.com/p/DEhitI1KeNL/", respond("Private media", 403));
    expect(priv.reason).toBe("private");

    const age = await fetchInstagramPost(
      "https://www.instagram.com/p/DEhitI1KeNL/",
      respond("People under 20 can't see this content", 400),
    );
    expect(age.reason).toBe("age_restricted");
  });

  it("reports share_unresolved when the share link does not point at a post", async () => {
    const fetchImpl = (async () => new Response("<html><body>Instagram</body></html>", { status: 200 })) as typeof fetch;
    const result = await fetchInstagramPost("https://www.instagram.com/share/reel/AAAAAAAAAAA/", fetchImpl);
    expect(result.post).toBeNull();
    expect(result.reason).toBe("share_unresolved");
  });
});
