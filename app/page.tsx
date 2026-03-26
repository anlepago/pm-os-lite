import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-2">PM OS Lite</h1>
        <p className="text-muted-foreground text-lg">
          AI-powered product management operating system
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl mt-4">
        <Link
          href="/dashboard"
          className="group rounded-lg border border-border p-6 hover:bg-accent transition-colors"
        >
          <h2 className="text-xl font-semibold mb-2">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Overview of your products, PRDs, and AI insights.
          </p>
        </Link>

        <Link
          href="/products"
          className="group rounded-lg border border-border p-6 hover:bg-accent transition-colors"
        >
          <h2 className="text-xl font-semibold mb-2">Products</h2>
          <p className="text-sm text-muted-foreground">
            Manage products and their associated artifacts.
          </p>
        </Link>

        <Link
          href="/prds"
          className="group rounded-lg border border-border p-6 hover:bg-accent transition-colors"
        >
          <h2 className="text-xl font-semibold mb-2">PRDs</h2>
          <p className="text-sm text-muted-foreground">
            Create and review Product Requirement Documents.
          </p>
        </Link>

        <Link
          href="/review"
          className="group rounded-lg border border-border p-6 hover:bg-accent transition-colors"
        >
          <h2 className="text-xl font-semibold mb-2">AI Review</h2>
          <p className="text-sm text-muted-foreground">
            Run AI agents to review artifacts and detect drift.
          </p>
        </Link>
      </div>
    </main>
  );
}
