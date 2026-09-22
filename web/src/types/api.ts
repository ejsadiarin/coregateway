export interface SystemStats {
    cpu: number;
    memory: number;
    storage: number;
    temperature: number;
    uptime: string;
    network: {
        up: string;
        down: string;
    };
}

export interface ServiceStatus {
    name: string;
    status: "online" | "offline" | "degraded" | "maintenance" | "unknown";
    type: string;
}

export interface Service {
    id: string;
    name: string;
    url: string;
    icon?: string;
    description?: string;
    service_type?: string;
    health_check_interval: number;
    health_check_method: string;
    expected_status_codes: number[];
    timeout: number;
    created_at: string;
    updated_at: string;
    is_active: boolean;
    current_status?:
        | "online"
        | "offline"
        | "degraded"
        | "maintenance"
        | "unknown";
    last_check?: string;
    response_time?: number;
}

export interface ServiceHealthHistory {
    id: string;
    service_id: string;
    status: string;
    response_time?: number;
    status_code?: number;
    error_message?: string;
    checked_at: string;
}

export interface ServiceStats {
    service_id: string;
    uptime_24h: number;
    uptime_7d: number;
    uptime_30d: number;
    avg_response_time: number;
    total_checks: number;
    successful_checks: number;
}

export interface CreateServiceRequest {
    name: string;
    url: string;
    icon?: string;
    description?: string;
    service_type?: string;
    health_check_interval?: number;
    health_check_method?: string;
    expected_status_codes?: number[];
    timeout?: number;
}

export interface UpdateServiceRequest {
    name?: string;
    url?: string;
    icon?: string;
    description?: string;
    service_type?: string;
    health_check_interval?: number;
    health_check_method?: string;
    expected_status_codes?: number[];
    timeout?: number;
    is_active?: boolean;
}

// Budget Types

export interface PriorityGroup {
    id: string;
    name: string;
    description: string;
}

export interface Category {
    id: string;
    name: string;
    color?: string;
    icon?: string;
    is_active: boolean;
}

export interface Tag {
    id: string;
    name: string;
    color?: string;
}

export interface Expense {
    id: string;
    description: string;
    amount: number;
    currency: string;
    category_id?: string;
    expense_date: string;
    notes?: string;
    recurring_type: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
    priority: "need" | "want" | "savings";
    status: "pending" | "posted" | "skipped";
    is_debt: boolean;
    start_date?: string;
    end_date?: string;
    source_rule_id?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateCategoryRequest {
    name: string;
    color?: string;
    icon?: string;
}

export interface UpdateCategoryRequest {
    name: string;
    color?: string;
    icon?: string;
}

export interface CreateTagRequest {
    name: string;
    color?: string;
}

export interface UpdateTagRequest {
    name: string;
    color?: string;
}

export interface CreateExpenseRequest {
    description: string;
    amount: number;
    currency: string;
    category_id?: string;
    expense_date: string;
    notes?: string;
    recurring_type: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
    priority: "need" | "want" | "savings";
    status: "pending" | "posted" | "skipped";
    is_debt: boolean;
    start_date?: string;
    end_date?: string;
    source_rule_id?: string;
}

export interface UpdateExpenseRequest {
    description?: string;
    amount?: number;
    currency?: string;
    category_id?: string;
    expense_date?: string;
    notes?: string;
    recurring_type?: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
    priority?: "need" | "want" | "savings";
    status?: "pending" | "posted" | "skipped";
    is_debt?: boolean;
    start_date?: string;
    end_date?: string;
    source_rule_id?: string;
}

export interface ExpenseFilters {
    start_date?: string;
    end_date?: string;
    category_id?: string;
    recurring_type?: string;
}

// Pagination Types

export interface OffsetPagination {
    total: number;
    page: number;
    page_size: number;
    totalPages: number;
    hasMore: boolean;
}

export interface PaginatedResponse<T> {
    data: T[];
    pagination: OffsetPagination;
}

export interface PaginationParams {
    page?: number;
    page_size?: number;
}

export interface Income {
    id: string;
    amount: number;
    currency: string;
    date: string;
    description?: string;
    category_id?: string;
    notes?: string;
    recurring_type: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
    priority: "need" | "want" | "savings";
    status: "pending" | "posted" | "skipped";
    start_date?: string;
    end_date?: string;
    source_rule_id?: string;
    created_at: string;
    updated_at: string;
}

export interface RecurringIncomeWithNextDate {
    id: string;
    amount: number;
    currency: string;
    description: string;
    recurring_type: string;
    start_date: string;
    end_date?: string;
    created_at: string;
    updated_at: string;
}

export interface RecurringExpenseRule {
    id: string;
    amount: number;
    currency: string;
    description: string;
    category_id?: string | null;
    notes?: string;
    recurring_type: string;
    start_date: string;
    end_date?: string;
    priority: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface RecurringSummary {
    total_recurring_income: number;
    total_recurring_expenses: number;
    net_recurring_cash_flow: number;
    recurring_income_count: number;
    recurring_expense_count: number;
}

export interface CreateIncomeRequest {
    amount: number;
    currency: string;
    date: string;
    description?: string;
    notes?: string;
    recurring_type: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
    priority?: "need" | "want" | "savings";
    status?: "pending" | "posted" | "skipped";
    start_date?: string;
    end_date?: string;
    source_rule_id?: string;
}

export interface UpdateIncomeRequest {
    amount?: number;
    currency?: string;
    date?: string;
    description?: string;
    notes?: string;
    recurring_type?: "one-time" | "daily" | "weekly" | "monthly" | "yearly";
    priority?: "need" | "want" | "savings";
    status?: "pending" | "posted" | "skipped";
    start_date?: string;
    end_date?: string;
    source_rule_id?: string;
}

export interface BudgetRemainingResponse {
    period_start: string;
    period_end: string;
    total_income: number;
    total_expense: number;
    remaining: number;
}

export interface SummaryStats {
    total_incomes: number;
    total_expenses: number;
    expense_count: number;
    income_count: number;
}

export interface CategoryBreakdown {
    category_id: string;
    category_name: string;
    category_color?: string;
    expense_count: number;
    total_amount: number;
}

export interface TrendItem {
    month: string;
    total_expenses: number;
    total_incomes: number;
}

// Auth Types

export type UserRole = "guest" | "user" | "admin";

export interface User {
    id: string;
    email: string;
    role: UserRole;
    created_at: string;
}

export interface LoginRequest {
    email: string;
    password: string;
    remember_me?: boolean;
}

export interface RegisterRequest {
    email: string;
    password: string;
}

export interface CreateUserRequest {
    email: string;
    password: string;
    role: UserRole;
}

export interface UpdateUserRequest {
    email?: string;
    password?: string;
    role?: UserRole;
}

// Budget Analytics Types

export interface SavingsRateResponse {
    total_incomes: number;
    total_expenses: number;
    savings_rate: number;
}

export interface SpendingVelocityResponse {
    avg_monthly_spending: number;
    months_with_data: number;
}

export interface UpcomingBill {
    id: string;
    description: string;
    amount: number;
    currency: string;
    recurring_type: string;
    start_date: string;
    end_date: string;
    category_id: string;
    notes: string;
    priority: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    category_name: string;
    category_color: string;
}

export type UpcomingBillsResponse = UpcomingBill[];

// Financial Health Types

export interface FiftyThirtyTwentyResponse {
    total_incomes: number;
    total_expenses: number;
    needs: number;
    wants: number;
    savings: number;
    needs_pct: number;
    wants_pct: number;
    savings_pct: number;
}

export interface MonthOverMonthItem {
    month: string;
    total_amount: number;
}

export type MonthOverMonthResponse = MonthOverMonthItem[];

export interface CurrentTotalMoneyResponse {
    total_money: number;
}

export interface IncomeOccurrence {
    id: string;
    source_income_id: string;
    source_rule_id?: string;
    amount: number;
    currency: string;
    date: string;
    description?: string;
    recurring_type?: 'daily' | 'weekly' | 'monthly' | null;
    status: string;
    is_virtual: boolean;
    is_skipped: boolean;
}

// Category Budget Types (not yet implemented in corefinance)

export interface CategoryBudget {
    id: string;
    category_id: string;
    month: string;
    budget_amount: number;
}

export interface CategoryBudgetWithVariance {
    category_id: string;
    category_name: string;
    category_color?: string;
    budget_amount: number;
    spent_amount: number;
    variance?: number;
    percentage: number;
    transaction_count: number;
}

export interface CreateCategoryBudgetRequest {
    category_id: string;
    month: string;
    budget_amount: number;
}

export interface UpdateCategoryBudgetRequest {
    budget_amount?: number;
}

// Subscription type (used by skip dialog, backed by recurring expenses)
export interface SubscriptionItem {
    id: string;
    description: string;
    amount: number;
    currency: string;
    recurring_type: string;
    category_name?: string;
    next_due_date: string;
}

export interface SubscriptionsResponse {
    subscriptions: SubscriptionItem[];
    count: number;
    total_monthly: number;
}

export interface MerchantAnalysisItem {
    name: string;
    total_spent: number;
    count: number;
    average_amount: number;
    percentage: number;
}

export interface MerchantAnalysisResponse {
    merchants: MerchantAnalysisItem[];
    unique_merchant_count: number;
    total_spent: number;
}

export interface HealthScoreResponse {
    score: number;
    status: "excellent" | "good" | "fair" | "poor";
    savings_rate: number;
    debt_to_income: number;
    emergency_fund_months: number;
    factor_scores: {
        savings_rate: number;
        debt_to_income: number;
        emergency_fund: number;
    };
    recommendations: string[];
}

export interface WeekdayPatternResponse {
    day: string;
    total_amount: number;
    count: number;
}

// Budget Import / Export Types

export interface ImportExportMetadata {
    schema_version: string;
    exported_at: string;
    source: string;
}

export interface ImportIncomeRecord {
    id?: string;
    amount: number;
    currency: string;
    date: string;
    description?: string;
    recurring_type?: "daily" | "weekly" | "monthly" | null;
    start_date?: string;
    end_date?: string;
}

export interface ImportExpenseRecord {
    id?: string;
    description: string;
    amount: number;
    currency: string;
    expense_date: string;
    category_name?: string;
    notes?: string;
    recurring_type?: "daily" | "weekly" | "monthly" | "yearly" | null;
    start_date?: string;
    end_date?: string;
    priority?: string;
    is_debt: boolean;
}

export interface BudgetExportPayload {
    metadata: ImportExportMetadata;
    incomes: ImportIncomeRecord[];
    expenses: ImportExpenseRecord[];
}

export type ImportMergeAction = "CREATE" | "SKIP_EXISTING" | "CONFLICT";

export interface ImportFieldDifference {
    field: string;
    incoming: unknown;
    existing: unknown;
}

export interface ImportConflictDetail {
    entity: string;
    date: string;
    existing_id?: string;
    incoming: unknown;
    existing: unknown;
    differences: ImportFieldDifference[];
}

export interface BudgetImportResultMetadata {
    imported_at: string;
    dry_run: boolean;
}

export interface BudgetImportSummary {
    incomes_created: number;
    incomes_skipped: number;
    incomes_conflicts: number;
    expenses_created: number;
    expenses_skipped: number;
    expenses_conflicts: number;
}

export interface ImportIncomeResult {
    input_index: number;
    action: ImportMergeAction;
    existing_id?: string;
    conflict?: ImportConflictDetail;
}

export interface ImportExpenseResult {
    input_index: number;
    action: ImportMergeAction;
    existing_id?: string;
    conflict?: ImportConflictDetail;
}

export interface BudgetImportResult {
    metadata: BudgetImportResultMetadata;
    summary: BudgetImportSummary;
    incomes: ImportIncomeResult[];
    expenses: ImportExpenseResult[];
    conflicts?: ImportConflictDetail[];
}

export interface SkipIncomeRequest {
    id: string;
}

export interface SkipExpenseRequest {
    id: string;
}
