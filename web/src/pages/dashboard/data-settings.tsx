import { useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { EXPORT_PARTS, ExportFileError, MAX_IMPORT_BYTES, downloadExport, importExport, readExportFile } from "@/lib/export";
import type { FilePart, ImportResponse, PartResult } from "@/types/export";

// DataSettings is the Data section of the Settings page: export your data
// as one file with a part per service, and import a file's parts back
// (coregateway ADR-0008). Import keeps every record's id, so what you
// already have is skipped and importing twice changes nothing.
export function DataSettings() {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <ExportPanel />
      <ImportPanel />
    </div>
  );
}

function PanelTitle({ children }: { children: string }) {
  return <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{children}</h3>;
}

function PartCheckbox({
  id,
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 border-b border-border py-2.5 last:border-b-0",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}

function toggle(list: string[], name: string, on: boolean): string[] {
  return on ? [...new Set([...list, name])] : list.filter((n) => n !== name);
}

function ExportPanel() {
  const [chosen, setChosen] = useState<string[]>(EXPORT_PARTS.map((p) => p.name));
  const exporting = useMutation({ mutationFn: downloadExport });

  return (
    <div>
      <PanelTitle>Export</PanelTitle>
      <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
        One JSON file with a part per service, each with its own format and version.
      </p>
      <div className="mt-3" role="group" aria-label="Parts to export">
        {EXPORT_PARTS.map((p) => (
          <PartCheckbox
            key={p.name}
            id={`export-part-${p.name}`}
            label={p.label}
            detail={p.blurb}
            checked={chosen.includes(p.name)}
            onChange={(on) => setChosen((c) => toggle(c, p.name, on))}
          />
        ))}
      </div>
      <Button className="mt-4 min-h-11" disabled={!chosen.length || exporting.isPending} onClick={() => exporting.mutate(chosen)}>
        <Download className="h-4 w-4" aria-hidden />
        {exporting.isPending ? "Exporting…" : "Export"}
      </Button>
      <p className="mt-2 min-h-5 text-sm" role="status">
        {exporting.isSuccess && <span className="text-muted-foreground">Saved {exporting.data}</span>}
        {exporting.isError && <span className="text-destructive">{exporting.error.message}</span>}
      </p>
    </div>
  );
}

interface ChosenFile {
  name: string;
  text: string;
  parts: FilePart[];
}

function ImportPanel() {
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const run = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) => {
      const inFile = file!.parts.filter((p) => p.known).map((p) => p.name);
      return importExport(file!.text, chosen, inFile, dryRun);
    },
    onSuccess: (res) => {
      setResult(res);
      // A real import changes data every page reads.
      if (!res.dry_run) queryClient.invalidateQueries();
    },
    onError: () => setResult(null),
  });

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    setFile(null);
    setResult(null);
    setFileError(null);
    run.reset();
    if (!picked) return;
    if (picked.size > MAX_IMPORT_BYTES) {
      setFileError("This file is larger than 25 MB.");
      return;
    }
    const text = await picked.text();
    try {
      const parts = readExportFile(text);
      setFile({ name: picked.name, text, parts });
      setChosen(parts.filter((p) => p.known).map((p) => p.name));
    } catch (err) {
      setFileError(err instanceof ExportFileError ? err.message : "Couldn't read this file.");
    }
  };

  const busy = run.isPending;
  return (
    <div>
      <PanelTitle>Import</PanelTitle>
      <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
        Brings a file's parts into your own data. Anything you already have is skipped, so importing twice changes nothing.
      </p>

      {isGuest ? (
        <p className="mt-3 text-sm text-muted-foreground">The demo account can't import. Create an account to keep your data.</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2">
            <Label htmlFor="import-file">Export file</Label>
            <Input id="import-file" type="file" accept="application/json,.json" onChange={choose} disabled={busy} />
          </div>
          {fileError && <p className="mt-2 text-sm text-destructive">{fileError}</p>}

          {file && (
            <>
              <div className="mt-3" role="group" aria-label="Parts to import">
                {file.parts.map((p) => {
                  const known = EXPORT_PARTS.find((k) => k.name === p.name);
                  const detail = !p.known
                    ? "Not on this server; it will be skipped"
                    : p.version === 0
                      ? "An older export, from before versions"
                      : `Version ${p.version}`;
                  return (
                    <PartCheckbox
                      key={p.name}
                      id={`import-part-${p.name}`}
                      label={known?.label ?? p.name}
                      detail={detail}
                      checked={p.known && chosen.includes(p.name)}
                      disabled={!p.known || busy}
                      onChange={(on) => {
                        setChosen((c) => toggle(c, p.name, on));
                        setResult(null);
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" disabled={!chosen.length || busy} onClick={() => run.mutate({ dryRun: true })}>
                  <FileCheck2 className="h-4 w-4" aria-hidden />
                  Check
                </Button>
                <Button className="min-h-11" disabled={!chosen.length || busy} onClick={() => run.mutate({ dryRun: false })}>
                  <Upload className="h-4 w-4" aria-hidden />
                  {busy && !run.variables?.dryRun ? "Importing…" : "Import"}
                </Button>
              </div>
            </>
          )}
          {run.isError && <p className="mt-2 text-sm text-destructive">{run.error.message}</p>}
          {result && <ImportResults result={result} />}
        </>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<PartResult["status"], string> = {
  imported: "text-accent",
  skipped: "text-muted-foreground",
  failed: "text-destructive",
};

function statusLabel(r: PartResult): string {
  if (r.status === "imported") return r.dry_run ? "Would import" : "Imported";
  if (r.status === "skipped") return "Skipped";
  return r.dry_run ? "Would fail" : "Failed";
}

function ImportResults({ result }: { result: ImportResponse }) {
  return (
    <div className="mt-5" aria-live="polite">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {result.dry_run ? "Check: nothing was written" : "Import result"}
      </p>
      <ul className="mt-2">
        {Object.entries(result.parts).map(([name, r]) => {
          const label = EXPORT_PARTS.find((p) => p.name === name)?.label ?? name;
          const counts = Object.entries(r.counts ?? {}).filter(([, c]) => c.created || c.skipped);
          return (
            <li key={name} className="border-b border-border py-3 last:border-b-0" data-testid={`import-result-${name}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{label}</span>
                <span className={cn("font-mono text-[11px] uppercase tracking-[0.18em]", STATUS_STYLE[r.status])}>● {statusLabel(r)}</span>
              </div>
              {r.status === "imported" && counts.length > 0 && (
                <dl className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm">
                  <dt className="sr-only">Kind</dt>
                  {counts.map(([entity, c]) => (
                    <div key={entity} className="contents">
                      <dt className="capitalize text-muted-foreground">{entity}</dt>
                      <dd className="tabular-nums">{c.created} new</dd>
                      <dd className="tabular-nums text-muted-foreground">{c.skipped} already here</dd>
                    </div>
                  ))}
                </dl>
              )}
              {r.status === "imported" && counts.length === 0 && <p className="mt-1 text-sm text-muted-foreground">Nothing in this part.</p>}
              {r.errors?.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {r.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className={r.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                      {e.entity !== "part" && <span className="capitalize">{e.entity} </span>}
                      {e.id && <span className="font-mono text-xs">{e.id.slice(0, 8)} </span>}
                      {e.reason}
                    </li>
                  ))}
                  {r.errors.length > 5 && <li className="text-muted-foreground">and {r.errors.length - 5} more</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
