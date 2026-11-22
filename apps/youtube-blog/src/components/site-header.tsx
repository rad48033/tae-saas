import Link from "next/link";

export function SiteHeader({ pdfUrl }: { pdfUrl: string }) {
  return (
    <header className="safe-top sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">t</span>
          <span className="text-lg font-extrabold tracking-tight text-ink">taest</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm text-slate-600">
          <a href="#features" className="hidden rounded-lg px-3 py-2 hover:bg-slate-50 sm:block">
            기능
          </a>
          <a href="#pricing" className="rounded-lg px-3 py-2 hover:bg-slate-50">
            요금
          </a>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-lg px-3 py-2 hover:bg-slate-50 md:block"
          >
            PDF API
          </a>
          <a href="#convert" className="btn-primary !px-4 !py-2 text-xs sm:text-sm">
            무료로 써보기
          </a>
        </nav>
      </div>
    </header>
  );
}
