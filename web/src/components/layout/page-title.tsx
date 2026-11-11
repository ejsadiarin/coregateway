import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// A page whose URL ends in an id (a Kanban or Draw board) names itself here,
// so the header's breadcrumb shows "tite" rather than the board's UUID.

interface PageTitleState {
  title: string | undefined;
  setTitle: (title: string | undefined) => void;
}

const PageTitleContext = createContext<PageTitleState>({ title: undefined, setTitle: () => {} });

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | undefined>();
  return <PageTitleContext.Provider value={{ title, setTitle }}>{children}</PageTitleContext.Provider>;
}

// usePageTitle names the current page for the breadcrumb while it is
// mounted; undefined (still loading) leaves the breadcrumb's placeholder.
export function usePageTitle(title: string | undefined) {
  const { setTitle } = useContext(PageTitleContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(undefined);
  }, [title, setTitle]);
}

export function useCurrentPageTitle(): string | undefined {
  return useContext(PageTitleContext).title;
}
