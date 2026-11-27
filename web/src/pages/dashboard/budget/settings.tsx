import { motion } from "motion/react";
import { useState } from "react";
import {
  useExpenseCategories,
  useIncomeCategories,
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
} from "@/hooks/use-budget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Edit2, Save, X, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Category, Tag } from "@/types/api";
import { useToast } from "@/components/ui/toast";
import { GuestBlockedError } from "@/hooks/use-budget";

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

// BudgetSettings is the Budget section of the Settings page: the fixed
// category lists and tags. Import and export live in the Data section.
export function BudgetSettings() {
  const { data: expenseCategories, isLoading: expenseCategoriesLoading } = useExpenseCategories();
  const { data: incomeCategories, isLoading: incomeCategoriesLoading } = useIncomeCategories();
  const { data: tags, isLoading: tagsLoading } = useTags();

  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();
  const { showToast } = useToast();

  // Tag form state
  const [newTag, setNewTag] = useState({ name: "", color: "#8b5cf6" });
  const [editingTag, setEditingTag] = useState<Tag | null>(null);

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
