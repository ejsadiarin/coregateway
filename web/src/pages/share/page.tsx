import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { queryClient } from "@/contexts/query-context";
import { feedKey, postNote, SessionExpiredError } from "@/lib/feed";
import { sharedFrom, sharedNoteText } from "@/lib/share";
import { Button } from "@/components/ui/button";

// The manifest's share_target: another app shares a title, text or link
// here, and it is posted to the Feed as one plain note. Signed out, it goes
// through login and comes back with the share still in the URL.
export default function SharePage() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const here = location.pathname + location.search;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const text = sharedNoteText(sharedFrom(params));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Posts once per attempt, even when StrictMode runs the effect twice.
  const posted = useRef(-1);

  useEffect(() => {
    if (!isAuthenticated || text === null || posted.current === attempt) return;
    posted.current = attempt;
    setError(null);
    postNote({ text })
      .then(async (note) => {
        await queryClient.invalidateQueries({ queryKey: feedKey });
        // Replaces /share, so going back never shares it again.
        navigate("/dashboard/feed", { replace: true, state: { shared: note.id } });
      })
      .catch((err: unknown) => {
        // The session ended after the app last checked: sign in again and
        // come back here, the share still in the URL.
        if (err instanceof SessionExpiredError) navigate("/login", { replace: true, state: { from: here } });
        else setError(err instanceof Error ? err.message : "Couldn't reach coreban");
      });
  }, [isAuthenticated, text, attempt, navigate, here]);

  if (!isLoading && !isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: here }} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tighter">
        <Share2 className="h-5 w-5 text-primary" aria-hidden />
        Share to the Feed
      </h1>

      {text === null ? (
        <>
          <p className="text-sm text-muted-foreground">Nothing was shared: the app sent no title, text or link.</p>
          <OpenFeed />
        </>
      ) : (
        <>
          <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-3 text-sm">
            {text}
          </p>
          {error ? (
            <>
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Couldn't share this to the Feed: {error}. It's still here; retry when you're back online.
                </span>
              </p>
              <div className="flex gap-2">
                <Button className="min-h-11" onClick={() => setAttempt((a) => a + 1)}>
                  Retry
                </Button>
                <OpenFeed />
              </div>
            </>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Posting to your Feed…
            </p>
          )}
        </>
      )}
    </main>
  );
}

function OpenFeed() {
  return (
    <Button asChild variant="outline" className="min-h-11 self-start">
      <Link to="/dashboard/feed">Open the Feed</Link>
    </Button>
  );
}
