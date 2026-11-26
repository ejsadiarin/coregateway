import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { format } from "date-fns";
import { AlertCircle, DatabaseBackup, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { useBackups, useStartBackup } from "@/hooks/use-backups";

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
}

export default function BackupsPage() {
    const navigate = useNavigate();
    const { isAdmin, isLoading: authLoading } = useAuth();
    const { data, isLoading, error } = useBackups();
    const startBackup = useStartBackup();

    if (!authLoading && !isAdmin) {
        navigate("/dashboard", { replace: true });
        return null;
    }

    // DESIGN.md: skeletal blocks, not spinners.
    if (isLoading || authLoading) {
        return (
            <div className="px-4 md:px-6 py-6 space-y-6">
                <div className="h-14 w-64 rounded-md bg-muted/40 animate-pulse" />
                <div className="h-9 w-36 rounded-md bg-muted/40 animate-pulse" />
                <div className="h-40 rounded-lg border border-border bg-muted/20 animate-pulse" />
            </div>
        );
    }

    const running = data?.running || startBackup.isPending;
    const backups = data?.backups ?? [];

    return (
        <div className="px-4 md:px-6 py-6">
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8"
            >
                <div className="flex items-center gap-3 mb-2">
                    <DatabaseBackup className="w-6 h-6 text-destructive" />
                    <h1 className="text-2xl text-primary">Backups</h1>
                </div>
                <p className="text-muted-foreground">
                    Copies of the whole database, kept on the homelab
                </p>
            </motion.div>

            {error && (
                <Alert variant="destructive" className="mb-6">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error.message}</AlertDescription>
                </Alert>
            )}

            {data && !data.configured ? (
                <Alert className="mb-6">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        Backups are not configured: the gateway has no owner connection
                        (MIGRATION_URL).
                    </AlertDescription>
                </Alert>
            ) : (
                <>
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6"
                    >
                        <Button
                            onClick={() => startBackup.mutate()}
                            disabled={running}
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                            <Play className="w-4 h-4" />
                            {running ? "Backing up…" : "Back up now"}
                        </Button>
                        {startBackup.error && (
                            <span className="text-sm text-destructive">
                                {startBackup.error.message}
                            </span>
                        )}
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="rounded-lg border border-border bg-card/50"
                    >
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Taken</TableHead>
                                    <TableHead>Kind</TableHead>
                                    <TableHead className="text-right">Size</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {backups.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                            <DatabaseBackup className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <p>No backups yet. The first nightly one runs at 02:00.</p>
                                            <Button
                                                variant="link"
                                                onClick={() => startBackup.mutate()}
                                                disabled={running}
                                            >
                                                Back up now
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    backups.map((b) => (
                                        <TableRow key={b.name}>
                                            <TableCell className="font-mono tabular-nums" title={b.name}>
                                                {format(new Date(b.taken_at), "MMM d, yyyy HH:mm")}
                                            </TableCell>
                                            <TableCell>
                                                <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                                    {b.kind}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                                                {formatSize(b.size_bytes)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </motion.div>
                </>
            )}
        </div>
    );
}
