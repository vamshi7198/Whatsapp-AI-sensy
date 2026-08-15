import Link from "next/link";

/**
 * A bad URL, or a notFound() from a page whose record has been deleted.
 *
 * Several routes call notFound() deliberately — a campaign that no longer
 * exists, a contact that was erased — so this is reached by ordinary use, not
 * only by mistyping. Without it those all showed the default Next.js 404 with
 * no way back into the app.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        That page does not exist
      </h1>

      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        The link may be out of date, or whatever it pointed at has since been
        deleted.
      </p>

      <Link
        href="/"
        className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-slate-50 dark:bg-slate-50 dark:text-slate-900"
      >
        Go to the dashboard
      </Link>
    </div>
  );
}
