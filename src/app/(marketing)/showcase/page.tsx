import Link from "next/link";

export default function ShowcasePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-extrabold tracking-tight text-white">Showcase</h1>
      <p className="mt-3 text-sm text-slate-400">
        Public demo assets and review materials for the Monstera Cloud Looker Studio connector.
      </p>

      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
        <h2 className="text-base font-bold text-white">Video upload</h2>
        <p className="mt-2 text-sm text-slate-300">
          Upload your MP4 into <span className="font-mono">public/showcase/</span> in this repo, then redeploy.
          It will be available at:
        </p>
        <div className="mt-3 rounded-xl border border-slate-800 bg-black/20 p-4 text-sm text-slate-200">
          <div className="text-slate-400">Example URL</div>
          <div className="mt-1 font-mono">https://monsteracloud.com/showcase/demo.mp4</div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Tip: keep the filename simple (lowercase, no spaces).
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
        <h2 className="text-base font-bold text-white">Helpful links</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          <li>
            <Link className="text-emerald-400 hover:underline" href="/looker-studio">
              Looker Studio connector (add-on page)
            </Link>
          </li>
          <li>
            <Link className="text-emerald-400 hover:underline" href="/support">
              Support page
            </Link>
          </li>
          <li>
            <Link className="text-emerald-400 hover:underline" href="/destinations">
              Destinations (product)
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}

