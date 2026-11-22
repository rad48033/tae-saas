export function SiteFooter() {
  return (
    <footer className="safe-bottom border-t border-slate-100 bg-slate-50/60">
      <div className="container-page flex flex-col gap-4 py-10 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-700">taest</p>
          <p className="mt-1">유튜브를 발행 가능한 콘텐츠로. 한국어·영어 지원.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <a href="/api/health" className="hover:text-slate-700">
            상태
          </a>
          <a href="#pricing" className="hover:text-slate-700">
            요금
          </a>
          <a href="mailto:rad48033@gmail.com" className="hover:text-slate-700">
            문의
          </a>
          <span>© {new Date().getFullYear()} taest</span>
        </div>
      </div>
    </footer>
  );
}
