import Link from "next/link";

export default function ShowcasePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 pt-28 pb-20 font-sans text-ink">
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
        <span>Review Materials</span>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Showcase</h1>
      <p className="mt-3 text-xs sm:text-sm text-ink-mute leading-relaxed">
        Public demo assets and review materials for the Monstera Cloud Looker Studio connector.
      </p>

      <div className="mt-8 rounded-lg border border-line bg-panel p-6">
        <h2 className="text-sm font-bold text-ink">Video upload</h2>
        <p className="mt-2 text-xs text-ink-mute">
          Upload your MP4 into <span className="font-mono text-ink">public/showcase/</span> in this repo, then redeploy.
          It will be available at:
        </p>
        <div className="mt-3 rounded-md border border-line bg-canvas p-3 text-xs text-ink">
          <div className="text-[11px] text-ink-mute">Example URL</div>
          <div className="mt-1 font-mono text-accent">https://monsteracloud.com/showcase/demo.mp4</div>
        </div>
        <p className="mt-3 text-[11px] text-ink-mute">
          Tip: keep the filename simple (lowercase, no spaces).
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-panel p-6">
        <h2 className="text-sm font-bold text-ink">Helpful links</h2>
        <ul className="mt-3 space-y-2 text-xs text-ink-mute">
          <li>
            <Link className="text-accent hover:underline" href="/looker-studio">
              Looker Studio connector (add-on page)
            </Link>
          </li>
          <li>
            <Link className="text-accent hover:underline" href="/support">
              Support page
            </Link>
          </li>
          <li>
            <Link className="text-accent hover:underline" href="/destinations">
              Destinations (product)
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}

