import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function MarketingShell({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s?.user));
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* Neon HUD backdrop */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage: `
            radial-gradient(1200px 600px at 15% -10%, oklch(0.62 0.19 255 / 0.22), transparent 60%),
            radial-gradient(900px 500px at 90% 10%, oklch(0.65 0.22 300 / 0.18), transparent 60%),
            linear-gradient(to bottom, oklch(0.16 0.02 260), oklch(0.11 0.02 260))
          `,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.9 0.02 255 / 0.6) 1px, transparent 1px), linear-gradient(90deg, oklch(0.9 0.02 255 / 0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at top, black 30%, transparent 75%)",
        }}
      />

      <header
        className={cn(
          "sticky top-0 z-40 border-b transition-colors",
          scrolled
            ? "border-white/10 bg-background/75 backdrop-blur-xl"
            : "border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link to="/reports" className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-md font-display text-sm font-bold text-white shadow-[0_0_24px_-4px_oklch(0.62_0.19_255/0.8)]"
              style={{ background: "linear-gradient(135deg, oklch(0.62 0.19 255), oklch(0.55 0.24 295))" }}
            >
              SL
            </span>
            <div className="leading-tight">
              <div className="font-display text-sm font-semibold tracking-tight">Strength Lab Hub</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Performance OS</div>
            </div>
          </Link>
          <nav className="ml-6 hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link to="/reports" className="transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Reports
            </Link>


            <Link to="/athlete-login" className="transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Athlete Sign In
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/reports"
              className="inline-flex h-9 items-center rounded-md border border-primary/40 px-3 text-sm font-medium text-foreground hover:bg-primary/10"
            >
              Reports
            </Link>
            {signedIn ? (

              <Link
                to="/performance"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[0_0_24px_-4px_oklch(0.62_0.19_255/0.8)] hover:opacity-90"
              >
                Open Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/athlete-login"
                  className="hidden h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-flex"
                >
                  Athlete Sign In
                </Link>
                <Link
                  to="/auth"
                  className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[0_0_24px_-4px_oklch(0.62_0.19_255/0.8)] hover:opacity-90"
                >
                  Coach Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-24 border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div>© {new Date().getFullYear()} Strength Lab Hub. Built for coaches.</div>
          <div className="flex gap-6">
            <Link to="/reports" className="hover:text-foreground">Reports</Link>

            
            <Link to="/athlete-login" className="hover:text-foreground">Athlete Sign In</Link>

            <Link to="/auth" className="hover:text-foreground">Coach Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function NeonCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm transition-colors hover:border-white/20",
        className,
      )}
    >
      {children}
    </div>
  );
}
