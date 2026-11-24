import { motion } from "motion/react";
import { useState, type ChangeEvent } from "react";
import {
  useExpenseCategories,
  useIncomeCategories,
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useExportBudgetJSON,
  useImportBudgetJSON,
} from "@/hooks/use-budget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Edit2, Save, X, Download, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Category, Tag, BudgetExportPayload, BudgetImportResult } from "@/types/api";
import { useToast } from "@/components/ui/toast";
import { GuestBlockedError } from "@/hooks/use-budget";
import { todayISODate } from "@/lib/budget-period";

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

function CategoryList({ categories, isLoading }: { categories?: Category[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2" aria-label="Loading categories">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-6 w-24 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
    );
  }
  if (!categories?.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <Tags className="h-4 w-4" aria-hidden />
        No categories came back from corefinance.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((category) => (
        <Badge
          key={category.id}
          style={{
            backgroundColor: category.color ? `${category.color}20` : undefined,
            borderColor: category.color || undefined,
            color: category.color || "inherit",
          }}
        >
          {category.icon && <span className="mr-1">{category.icon}</span>}
          {category.name}
        </Badge>
      ))}
    </div>
  );
}

// BudgetSettings is the Budget section of the Settings page: import and
// export, the fixed category lists, and tags.
export function BudgetSettings() {
  const { data: expenseCategories, isLoading: expenseCategoriesLoading } = useExpenseCategories();
  const { data: incomeCategories, isLoading: incomeCategoriesLoading } = useIncomeCategories();
  const { data: tags, isLoading: tagsLoading } = useTags();

  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();
  const exportBudget = useExportBudgetJSON();
  const importBudget = useImportBudgetJSON();
  const { showToast } = useToast();

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
      anchor.download = `budget-export-${todayISODate()}.json`;
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
      <div>
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
                <Download className="h-4 w-4" />
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

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Categories Section */}
        <div className="space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Expense categories</CardTitle>
                <CardDescription>The fixed list every expense picks from</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryList categories={expenseCategories} isLoading={expenseCategoriesLoading} />
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.15 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Income categories</CardTitle>
                <CardDescription>The fixed list every income picks from</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryList categories={incomeCategories} isLoading={incomeCategoriesLoading} />
              </CardContent>
            </Card>
          </motion.div>
        </div>

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
                    <Plus className="h-4 w-4" />
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
                              <Save className="h-4 w-4" />
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
