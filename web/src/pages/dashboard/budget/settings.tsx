import { motion } from "motion/react";
import { useState, type ChangeEvent } from "react";
import {
  useCategories,
  useTags,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useExportBudgetJSON,
  useImportBudgetJSON,
  useDryRunBackfill,
  useExecuteBackfill,
} from "@/hooks/use-budget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Edit2, Save, X, ArrowLeft, Download, Play, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Category, Tag, BudgetExportPayload, BudgetImportResult, BackfillResponse } from "@/types/api";
import { Link } from "react-router-dom";
import { useToast } from "@/components/ui/toast";
import { GuestBlockedError } from "@/hooks/use-budget";
import { useAuth } from "@/contexts/auth-context";
import { useUsers } from "@/hooks/use-users";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

function AdminBackfillCard() {
  const { showToast } = useToast();
  const { data: users, isLoading: usersLoading } = useUsers();
  const dryRun = useDryRunBackfill();
  const execute = useExecuteBackfill();

  const [targetUserId, setTargetUserId] = useState("self");
  const [dryRunResult, setDryRunResult] = useState<BackfillResponse | null>(null);
  const [dryRunTarget, setDryRunTarget] = useState<string | null>(null);
  const [executeResult, setExecuteResult] = useState<BackfillResponse | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const targetUser = targetUserId === "self" ? undefined : users?.find((u) => u.id === targetUserId);
  const request = targetUserId === "self" ? {} : { userId: targetUserId };
  const dryRunFresh = dryRunResult !== null && dryRunTarget === targetUserId;
  const legacyTotal = dryRunFresh ? (dryRunResult.legacy_total ?? 0) : null;
  const canExecute = dryRunFresh && (legacyTotal ?? 0) > 0 && !execute.isPending;

  const handleTargetChange = (value: string) => {
    setTargetUserId(value);
    setDryRunResult(null);
    setDryRunTarget(null);
    setExecuteResult(null);
    setBackfillError(null);
  };

  const handleCheck = async () => {
    try {
      const result = await dryRun.mutateAsync(request);
      setDryRunResult(result);
      setDryRunTarget(targetUserId);
      setExecuteResult(null);
      setBackfillError(null);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
        setBackfillError(error.message);
      } else {
        const message = error instanceof Error ? error.message : "Failed to check backfill";
        showToast(message, "error");
        setBackfillError(message);
      }
    }
  };

  const handleConfirmExecute = async () => {
    try {
      const result = await execute.mutateAsync(request);
      setExecuteResult(result);
      setBackfillError(null);
      setConfirmOpen(false);
      showToast("Backfill completed successfully", "success");
    } catch (error) {
      setConfirmOpen(false);
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
        setBackfillError(error.message);
      } else {
        const message = error instanceof Error ? error.message : "Failed to run backfill";
        showToast(message, "error");
        setBackfillError(message);
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Legacy backfill</CardTitle>
        <CardDescription>
          Materialize legacy inline recurring rules into records. Check first, then run. This converts rows irreversibly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="backfill-target">Target user</Label>
          <Select value={targetUserId} onValueChange={handleTargetChange} disabled={usersLoading}>
            <SelectTrigger id="backfill-target">
              <SelectValue placeholder="Self (own rows)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">Self (own rows)</SelectItem>
              {users?.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3 md:flex-row">
          <Button onClick={handleCheck} disabled={dryRun.isPending} variant="outline">
            <Search className="mr-2 h-4 w-4" />
            {dryRun.isPending ? "Checking..." : "Check"}
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!canExecute}>
            <Play className="mr-2 h-4 w-4" />
            {execute.isPending ? "Running..." : "Run backfill"}
          </Button>
        </div>

        {dryRunFresh && (
          <div className="grid gap-2 rounded-lg border p-4 text-sm md:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Legacy expenses</p>
              <p className="font-semibold">{dryRunResult.legacy_expenses ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Legacy incomes</p>
              <p className="font-semibold">{dryRunResult.legacy_incomes ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Legacy total</p>
              <p className="font-semibold">{dryRunResult.legacy_total ?? 0}</p>
            </div>
            {(legacyTotal ?? 0) === 0 && (
              <p className="text-muted-foreground md:col-span-3">Nothing to backfill for this target.</p>
            )}
          </div>
        )}

        {executeResult && (
          <div className="grid gap-2 rounded-lg border p-4 text-sm md:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-muted-foreground">Expense rules</p>
              <p className="font-semibold">{executeResult.expense_rules ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Income rules</p>
              <p className="font-semibold">{executeResult.income_rules ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Expense instances</p>
              <p className="font-semibold">{executeResult.expense_instances ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Income instances</p>
              <p className="font-semibold">{executeResult.income_instances ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Legacy remaining</p>
              <p className="font-semibold">{executeResult.legacy_remaining ?? 0}</p>
            </div>
          </div>
        )}

        {backfillError && <p className="text-destructive text-sm">{backfillError}</p>}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run backfill{targetUser ? ` for ${targetUser.email}` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This converts {legacyTotal ?? 0} legacy row(s){targetUser ? ` for ${targetUser.email}` : " in your own data"} into
              recurring rules and instances. Converted rows are flipped to one-time and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmExecute}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Run backfill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function SettingsPage() {
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: tags, isLoading: tagsLoading } = useTags();

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();
  const exportBudget = useExportBudgetJSON();
  const importBudget = useImportBudgetJSON();
  const { showToast } = useToast();
  const { isAdmin } = useAuth();

  // Category form state
  const [newCategory, setNewCategory] = useState({ name: "", color: "#3b82f6", icon: "" });
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Tag form state
  const [newTag, setNewTag] = useState({ name: "", color: "#8b5cf6" });
  const [editingTag, setEditingTag] = useState<Tag | null>(null);

  // Import/Export state
  const [importResult, setImportResult] = useState<BudgetImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const isBudgetExportPayload = (value: unknown): value is BudgetExportPayload => {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      !!candidate.metadata &&
      Array.isArray(candidate.incomes) &&
      Array.isArray(candidate.expenses)
    );
  };

  const handleExportBudget = async () => {
    try {
      const payload = await exportBudget.mutateAsync();
      const formatted = JSON.stringify(payload, null, 2);
      const blob = new Blob([formatted], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `budget-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
      showToast("Budget exported successfully", "success");
    } catch {
      showToast("Failed to export budget", "error");
    }
  };

  const handleImportBudget = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      const message = "Import file is too large (max 5MB)";
      showToast(message, "error");
      setImportResult(null);
      setImportError(message);
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!isBudgetExportPayload(parsed)) {
        throw new Error("Invalid export format");
      }

      const result = await importBudget.mutateAsync(parsed);
      setImportResult(result);
      setImportError(null);
      showToast("Budget imported successfully", "success");
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
        setImportError(error.message);
      } else {
        const message = error instanceof Error && error.message === "Invalid export format"
          ? "Invalid export format"
          : error instanceof Error
            ? error.message
            : "Failed to import budget";
        showToast(message, "error");
        setImportError(message);
      }
      setImportResult(null);
    } finally {
      event.target.value = "";
    }
  };

  // Category handlers
  const handleCreateCategory = async () => {
    if (!newCategory.name.trim()) return;
    try {
      await createCategory.mutateAsync(newCategory);
      showToast("Category created successfully", "success");
      setNewCategory({ name: "", color: "#3b82f6", icon: "" });
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to create category", "error");
      }
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory) return;
    try {
      await updateCategory.mutateAsync({
        id: editingCategory.id,
        data: {
          name: editingCategory.name,
          color: editingCategory.color,
          icon: editingCategory.icon,
        },
      });
      showToast("Category updated successfully", "success");
      setEditingCategory(null);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to update category", "error");
      }
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (confirm("Delete this category? This will not delete expenses.")) {
      try {
        await deleteCategory.mutateAsync(id);
        showToast("Category deleted successfully", "success");
      } catch (error) {
        if (error instanceof GuestBlockedError) {
          showToast(error.message, "warning");
        } else {
          showToast("Failed to delete category", "error");
        }
      }
    }
  };

  // Tag handlers
  const handleCreateTag = async () => {
    if (!newTag.name.trim()) return;
    try {
      await createTag.mutateAsync(newTag);
      showToast("Tag created successfully", "success");
      setNewTag({ name: "", color: "#8b5cf6" });
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to create tag", "error");
      }
    }
  };

  const handleUpdateTag = async () => {
    if (!editingTag) return;
    try {
      await updateTag.mutateAsync({
        id: editingTag.id,
        data: {
          name: editingTag.name,
          color: editingTag.color,
        },
      });
      showToast("Tag updated successfully", "success");
      setEditingTag(null);
    } catch (error) {
      if (error instanceof GuestBlockedError) {
        showToast(error.message, "warning");
      } else {
        showToast("Failed to update tag", "error");
      }
    }
  };

  const handleDeleteTag = async (id: string) => {
    if (confirm("Delete this tag? This will remove it from all expenses.")) {
      try {
        await deleteTag.mutateAsync(id);
        showToast("Tag deleted successfully", "success");
      } catch (error) {
        if (error instanceof GuestBlockedError) {
          showToast(error.message, "warning");
        } else {
          showToast("Failed to delete tag", "error");
        }
      }
    }
  };

  return (
      <div className="px-4 md:px-6 py-6">
      {/* Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Link to="/dashboard/budget">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Budget
          </Button>
        </Link>
        <h1 className="text-primary mb-2">BUDGET SETTINGS</h1>
        <p className="text-sm text-muted-foreground">
          Manage your categories and tags
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="mb-8"
      >
        <Card>
          <CardHeader>
            <CardTitle>Budget Import / Export</CardTitle>
            <CardDescription>Download your budget JSON or import a previous export</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <Button onClick={handleExportBudget} disabled={exportBudget.isPending} className="md:w-auto">
                <Download className="mr-2 h-4 w-4" />
                {exportBudget.isPending ? "Exporting..." : "Export JSON"}
              </Button>
              <div className="grid gap-2">
                <Label htmlFor="budget-import-file">Import JSON</Label>
                <Input
                  id="budget-import-file"
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportBudget}
                  disabled={importBudget.isPending}
                />
              </div>
            </div>

            {(importResult || importError) && (
              <div className="grid gap-2 rounded-lg border p-4 text-sm md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-semibold">
                    {(importResult?.summary.incomes_created || 0) + (importResult?.summary.expenses_created || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Skipped</p>
                  <p className="font-semibold">
                    {(importResult?.summary.incomes_skipped || 0) + (importResult?.summary.expenses_skipped || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Conflicts</p>
                  <p className="font-semibold">{importResult?.conflicts?.length || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Errors</p>
                  <p className="font-semibold">{importError ? 1 : 0}</p>
                </div>
                {importError && (
                  <p className="text-destructive md:col-span-2 lg:col-span-4">{importError}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {isAdmin && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.075 }}
          className="mb-8"
        >
          <AdminBackfillCard />
        </motion.div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Categories Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
              <CardDescription>Organize expenses by category</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add Category Form */}
              <div className="space-y-3 p-4 border rounded-lg">
                <Label>Add New Category</Label>
                <div className="grid gap-2">
                  <Input
                    placeholder="Category name"
                    value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Icon (emoji)"
                      value={newCategory.icon}
                      onChange={(e) => setNewCategory({ ...newCategory, icon: e.target.value })}
                    />
                    <Input
                      type="color"
                      value={newCategory.color}
                      onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })}
                    />
                  </div>
                  <Button
                    onClick={handleCreateCategory}
                    disabled={!newCategory.name.trim() || createCategory.isPending}
                    size="sm"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Category
                  </Button>
                </div>
              </div>

              {/* Categories List */}
              <div className="space-y-2">
                {categoriesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : categories && categories.length > 0 ? (
                  categories.map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      {editingCategory?.id === category.id ? (
                        <div className="flex-1 grid gap-2">
                          <Input
                            value={editingCategory.name}
                            onChange={(e) =>
                              setEditingCategory({ ...editingCategory, name: e.target.value })
                            }
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              value={editingCategory.icon || ""}
                              onChange={(e) =>
                                setEditingCategory({ ...editingCategory, icon: e.target.value })
                              }
                            />
                            <Input
                              type="color"
                              value={editingCategory.color || "#3b82f6"}
                              onChange={(e) =>
                                setEditingCategory({ ...editingCategory, color: e.target.value })
                              }
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleUpdateCategory}>
                              <Save className="mr-2 h-4 w-4" />
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingCategory(null)}
                            >
                              <X className="mr-2 h-4 w-4" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <Badge
                              style={{
                                backgroundColor: category.color ? `${category.color}20` : undefined,
                                borderColor: category.color || undefined,
                                color: category.color || "inherit",
                              }}
                            >
                              {category.icon && <span className="mr-1">{category.icon}</span>}
                              {category.name}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingCategory(category)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => handleDeleteCategory(category.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No categories yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Tags Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
              <CardDescription>Add labels to your expenses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add Tag Form */}
              <div className="space-y-3 p-4 border rounded-lg">
                <Label>Add New Tag</Label>
                <div className="grid gap-2">
                  <Input
                    placeholder="Tag name"
                    value={newTag.name}
                    onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                  />
                  <Input
                    type="color"
                    value={newTag.color}
                    onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                  />
                  <Button
                    onClick={handleCreateTag}
                    disabled={!newTag.name.trim() || createTag.isPending}
                    size="sm"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Tag
                  </Button>
                </div>
              </div>

              {/* Tags List */}
              <div className="space-y-2">
                {tagsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : tags && tags.length > 0 ? (
                  tags.map((tag) => (
                    <div
                      key={tag.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      {editingTag?.id === tag.id ? (
                        <div className="flex-1 grid gap-2">
                          <Input
                            value={editingTag.name}
                            onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                          />
                          <Input
                            type="color"
                            value={editingTag.color || "#8b5cf6"}
                            onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleUpdateTag}>
                              <Save className="mr-2 h-4 w-4" />
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingTag(null)}
                            >
                              <X className="mr-2 h-4 w-4" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Badge
                            style={{
                              backgroundColor: tag.color ? `${tag.color}20` : undefined,
                              borderColor: tag.color || undefined,
                              color: tag.color || "inherit",
                            }}
                          >
                            {tag.name}
                          </Badge>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingTag(tag)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => handleDeleteTag(tag.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No tags yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
