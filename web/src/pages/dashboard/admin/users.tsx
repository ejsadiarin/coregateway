import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { format } from "date-fns";
import {
    Shield,
    Plus,
    Pencil,
    Trash2,
    AlertCircle,
    User,
    Users,
    Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { useAuth } from "@/contexts/auth-context";
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from "@/hooks/use-users";
import type { User as UserType, UserRole, UpdateUserRequest } from "@/types/api";

export default function UsersPage() {
    const navigate = useNavigate();
    const { user: currentUser, isAdmin, isLoading: authLoading } = useAuth();
    const { data: users, isLoading, error } = useUsers();
    const createUser = useCreateUser();
    const updateUser = useUpdateUser();
    const deleteUser = useDeleteUser();

    const [searchQuery, setSearchQuery] = useState("");
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserType | null>(null);
    const [formError, setFormError] = useState("");

    // form state
    const [formEmail, setFormEmail] = useState("");
    const [formPassword, setFormPassword] = useState("");
    const [formRole, setFormRole] = useState<UserRole>("user");

    // redirect non-admins
    if (!authLoading && !isAdmin) {
        navigate("/dashboard", { replace: true });
        return null;
    }

    const filteredUsers = users?.filter((u) =>
        u.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const resetForm = () => {
        setFormEmail("");
        setFormPassword("");
        setFormRole("user");
        setFormError("");
    };

    const openEditModal = (user: UserType) => {
        setSelectedUser(user);
        setFormEmail(user.email);
        setFormPassword("");
        setFormRole(user.role);
        setFormError("");
        setIsEditModalOpen(true);
    };

    const openDeleteModal = (user: UserType) => {
        setSelectedUser(user);
        setIsDeleteModalOpen(true);
    };

    const handleCreate = async () => {
        setFormError("");
        if (!formEmail || !formPassword) {
            setFormError("Email and password are required");
            return;
        }
        if (formPassword.length < 8) {
            setFormError("Password must be at least 8 characters");
            return;
        }
        try {
            await createUser.mutateAsync({
                email: formEmail,
                password: formPassword,
                role: formRole,
            });
            setIsCreateModalOpen(false);
            resetForm();
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to create user");
        }
    };

    const handleUpdate = async () => {
        if (!selectedUser) return;
        setFormError("");
        
        const data: UpdateUserRequest = {};
        if (formEmail !== selectedUser.email) data.email = formEmail;
        if (formPassword) data.password = formPassword;
        if (formRole !== selectedUser.role) data.role = formRole;

        if (Object.keys(data).length === 0) {
            setIsEditModalOpen(false);
            return;
        }

        if (data.password && data.password.length < 8) {
            setFormError("Password must be at least 8 characters");
            return;
        }

        try {
            await updateUser.mutateAsync({ id: selectedUser.id, data });
            setIsEditModalOpen(false);
            resetForm();
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to update user");
        }
    };

    const handleDelete = async () => {
        if (!selectedUser) return;
        try {
            await deleteUser.mutateAsync(selectedUser.id);
            setIsDeleteModalOpen(false);
            setSelectedUser(null);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to delete user");
        }
    };

    const getRoleBadge = (role: UserRole) => {
        const styles = {
            admin: "bg-destructive/10 text-destructive border-destructive/30",
            user: "bg-primary/10 text-primary border-primary/30",
            guest: "bg-muted text-muted-foreground border-muted",
        };
        return (
            <Badge variant="outline" className={styles[role]}>
                {role.toUpperCase()}
            </Badge>
        );
    };

    const isDemoUser = (user: UserType) => user.email === "demo@example.com";
    const isCurrentUser = (user: UserType) => user.id === currentUser?.id;

    // DESIGN §4: the page's shape is known while it loads, so it shows as
    // a skeleton of the header, search bar, and user rows, not a spinner.
    if (isLoading || authLoading) {
        return (
            <div className="px-4 md:px-6 py-6" aria-busy="true" aria-label="Loading users">
                <div className="mb-8 space-y-3">
                    <div className="h-7 w-56 animate-pulse rounded bg-muted" />
                    <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
                </div>
                <div className="mb-6 flex flex-col gap-4 sm:flex-row">
                    <div className="h-9 flex-1 animate-pulse rounded-lg bg-muted" />
                    <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
                </div>
                <div className="rounded-lg border border-border bg-card/50 divide-y divide-border">
                    {Array.from({ length: 4 }, (_, i) => (
                        <div key={i} className="flex items-center gap-4 px-4 py-3">
                            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
                            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
                            <div className="hidden h-4 w-24 animate-pulse rounded bg-muted sm:block" />
                            <div className="h-8 w-20 animate-pulse rounded bg-muted" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 md:px-6 py-6">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8"
            >
                <div className="flex items-center gap-3 mb-2">
                    <Shield className="w-6 h-6 text-destructive" />
                    <h1 className="text-2xl text-primary">User Management</h1>
                </div>
                <p className="text-muted-foreground">
                    Manage system users and their access roles
                </p>
            </motion.div>

            {/* Actions Bar */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex flex-col sm:flex-row gap-4 mb-6"
            >
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search users by email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <Button
                    onClick={() => {
                        resetForm();
                        setIsCreateModalOpen(true);
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                    <Plus className="w-4 h-4" />
                    Add User
                </Button>
            </motion.div>

            {/* Error */}
            {error && (
                <Alert variant="destructive" className="mb-6">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error.message}</AlertDescription>
                </Alert>
            )}

            {/* Users Table */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-lg border border-border bg-card/50"
            >
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredUsers?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    No users found
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredUsers?.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <User className="w-4 h-4 text-muted-foreground" />
                                            {user.email}
                                            {isCurrentUser(user) && (
                                                <Badge variant="outline" className="text-xs">You</Badge>
                                            )}
                                            {isDemoUser(user) && (
                                                <Badge variant="outline" className="text-xs bg-accent/10 text-accent border-accent/30">
                                                    Demo
                                                </Badge>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {format(new Date(user.created_at), "MMM d, yyyy")}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => openEditModal(user)}
                                                className="text-muted-foreground hover:text-primary"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => openDeleteModal(user)}
                                                disabled={isCurrentUser(user) || isDemoUser(user)}
                                                className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </motion.div>

            {/* Create User Modal */}
            <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New User</DialogTitle>
                        <DialogDescription>
                            Add a new user to the system with specified role and credentials.
                        </DialogDescription>
                    </DialogHeader>
                    {formError && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{formError}</AlertDescription>
                        </Alert>
                    )}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="create-email">Email</Label>
                            <Input
                                id="create-email"
                                type="email"
                                value={formEmail}
                                onChange={(e) => setFormEmail(e.target.value)}
                                placeholder="user@example.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="create-password">Password</Label>
                            <Input
                                id="create-password"
                                type="password"
                                value={formPassword}
                                onChange={(e) => setFormPassword(e.target.value)}
                                placeholder="Min 8 characters"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="create-role">Role</Label>
                            <Select value={formRole} onValueChange={(v) => setFormRole(v as UserRole)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="guest">Guest (Read-only)</SelectItem>
                                    <SelectItem value="user">User (Standard)</SelectItem>
                                    <SelectItem value="admin">Admin (Full access)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreate}
                            disabled={createUser.isPending}
                            className="bg-primary text-primary-foreground"
                        >
                            {createUser.isPending ? "Creating..." : "Create User"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit User Modal */}
            <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit User</DialogTitle>
                        <DialogDescription>
                            Update user details. Leave password blank to keep unchanged.
                        </DialogDescription>
                    </DialogHeader>
                    {formError && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{formError}</AlertDescription>
                        </Alert>
                    )}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="edit-email">Email</Label>
                            <Input
                                id="edit-email"
                                type="email"
                                value={formEmail}
                                onChange={(e) => setFormEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-password">New Password (optional)</Label>
                            <Input
                                id="edit-password"
                                type="password"
                                value={formPassword}
                                onChange={(e) => setFormPassword(e.target.value)}
                                placeholder="Leave blank to keep current"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-role">Role</Label>
                            <Select value={formRole} onValueChange={(v) => setFormRole(v as UserRole)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="guest">Guest (Read-only)</SelectItem>
                                    <SelectItem value="user">User (Standard)</SelectItem>
                                    <SelectItem value="admin">Admin (Full access)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleUpdate}
                            disabled={updateUser.isPending}
                            className="bg-primary text-primary-foreground"
                        >
                            {updateUser.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Modal */}
            <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete User</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete{" "}
                            <span className="font-medium text-foreground">{selectedUser?.email}</span>?
                            This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    {formError && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{formError}</AlertDescription>
                        </Alert>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)}>
                            Cancel
                        </Button>
                        <HoldToConfirm onConfirm={handleDelete} pending={deleteUser.isPending}>
                            Hold to delete
                        </HoldToConfirm>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
