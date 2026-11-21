import { describe, expect, it } from "vitest";

import {
  decodeEntities,
  extractArticleFromHtml,
  extractInstagramCaption,
  htmlToText,
  isPrivateHost,
  safeUrl,
} from "../src/lib/article";

const HTML = `<!doctype html>
<html lang="ko">
<head>
  <title>콘텐츠 재활용 3단계 | 운영 노트</title>
  <meta property="og:title" content="콘텐츠 재활용 3단계" />
  <meta property="og:description" content="한 번 만든 콘텐츠를 세 채널로 다시 쓰는 방법" />
  <meta property="og:site_name" content="운영 노트" />
  <meta name="author" content="김운영" />
  <script>window.tracker = "should be removed";</script>
  <style>.hidden { display: none; }</style>
</head>
<body>
  <header><nav><a href="/">홈</a><a href="/about">소개</a></nav></header>
  <article>
    <h1>콘텐츠 재활용 3단계</h1>
    <p>첫 단계는 원문을 만드는 것입니다. 말로 풀어낸 기록이 글로 쓴 요약보다 사례가 많습니다.</p>
    <p>두 번째 단계는 주장을 하나만 고르는 것입니다. 모두 담으려 하면 요약문처럼 밋밋해집니다.</p>
    <ul><li>원문은 길게</li><li>주장은 하나만</li></ul>
    <p>세 번째 단계는 형식을 바꾸는 것입니다. 블로그는 문단, 카드뉴스는 한 장에 하나의 주장입니다.</p>
  </article>
  <footer>© 운영 노트</footer>
</body>
</html>`;

describe("article extraction", () => {
  it("picks title, author and the article body", () => {
    const article = extractArticleFromHtml(HTML, "https://blog.example.com/reuse");
    expect(article.title).toBe("콘텐츠 재활용 3단계");
    expect(article.author).toBe("김운영");
    expect(article.text).toContain("첫 단계는 원문을 만드는 것입니다");
    expect(article.text).toContain("• 원문은 길게");
    expect(article.text).not.toContain("should be removed");
    expect(article.text).not.toContain("display: none");
    expect(article.text).not.toContain("소개");
  });

  it("decodes entities and keeps paragraph breaks", () => {
    expect(htmlToText("<p>a &amp; b</p><p>c&nbsp;d</p>")).toBe("a & b\n\nc d");
    expect(decodeEntities("&#50864;&#47532; &#x1F600;")).toContain("우리");
    expect(decodeEntities("&unknown;")).toBe("&unknown;");
  });

  it("reads the Instagram caption from meta tags", () => {
    const instagramHtml = `<html><head>
      <meta property="og:title" content="하루 세 컷 on Instagram" />
      <meta property="og:description" content="1,248 likes, 32 comments - 캡션 첫 문장입니다. 두 번째 문장도 있습니다." />
      <meta property="og:site_name" content="Instagram" />
    </head><body></body></html>`;

    const post = extractInstagramCaption(instagramHtml, "https://www.instagram.com/p/abc/");
    expect(post.title).toBe("하루 세 컷");
    expect(post.text).toContain("캡션 첫 문장입니다");
    expect(post.text.startsWith("1,248")).toBe(false);
  });
});

describe("url safety", () => {
  it("normalizes urls and rejects non-http schemes", () => {
    expect(safeUrl("example.com/post")?.toString()).toBe("https://example.com/post");
    expect(safeUrl("ftp://example.com")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });

  it("blocks private network hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.0.1", "172.20.3.4", "169.254.1.1", "::1"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
    expect(isPrivateHost("blog.example.com")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
  });
});
