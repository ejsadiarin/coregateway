import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  /** show first/last page buttons for large page counts */
  showFirstLast?: boolean;
  /** number of sibling pages to show on each side of current page */
  siblingCount?: number;
  className?: string;
}

export function Pagination({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  disabled = false,
  showFirstLast = true,
  siblingCount = 1,
  className
}: PaginationProps) {
  // don't render if only one page
  if (totalPages <= 1) {
    return null;
  }

  // calculate page numbers to show with ellipsis
  const getPageNumbers = (): (number | 'ellipsis-start' | 'ellipsis-end')[] => {
    const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [];
    
    // calculate the range of pages to show around current page
    const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
    const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);
    
    // determine if we need ellipsis
    const shouldShowLeftEllipsis = leftSiblingIndex > 2;
    const shouldShowRightEllipsis = rightSiblingIndex < totalPages - 1;
    
    // always show first page
    pages.push(1);
    
    // add left ellipsis or page 2
    if (shouldShowLeftEllipsis) {
      pages.push('ellipsis-start');
    } else if (leftSiblingIndex > 1) {
      // fill in pages between 1 and leftSiblingIndex
      for (let i = 2; i < leftSiblingIndex; i++) {
        pages.push(i);
      }
    }
    
    // add sibling pages and current page
    for (let i = leftSiblingIndex; i <= rightSiblingIndex; i++) {
      if (i !== 1 && i !== totalPages) {
        pages.push(i);
      }
    }
    
    // add right ellipsis or remaining pages
    if (shouldShowRightEllipsis) {
      pages.push('ellipsis-end');
    } else if (rightSiblingIndex < totalPages) {
      // fill in pages between rightSiblingIndex and totalPages
      for (let i = rightSiblingIndex + 1; i < totalPages; i++) {
        pages.push(i);
      }
    }
    
    // always show last page (if more than 1 page)
    if (totalPages > 1) {
      pages.push(totalPages);
    }
    
    return pages;
  };

  const pageNumbers = getPageNumbers();
  const showFirstLastButtons = showFirstLast && totalPages > 5;

  const handlePageChange = (page: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && page !== currentPage && page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };

  return (
    <nav 
      className={cn("flex items-center justify-center gap-1", className)}
      aria-label="Pagination"
    >
      {/* first page button */}
      {showFirstLastButtons && (
        <Button
          variant="outline"
          size="sm"
          onClick={handlePageChange(1)}
          disabled={currentPage === 1 || disabled}
          type="button"
          aria-label="Go to first page"
          className="hidden sm:flex"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
      )}

      {/* previous page button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handlePageChange(currentPage - 1)}
        disabled={currentPage === 1 || disabled}
        type="button"
        aria-label="Go to previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {/* page numbers */}
      <div className="flex items-center gap-1">
        {pageNumbers.map((page) => {
          if (page === 'ellipsis-start' || page === 'ellipsis-end') {
            return (
              <span 
                key={page} 
                className="px-2 text-muted-foreground select-none"
                aria-hidden="true"
              >
                ...
              </span>
            );
          }

          const isCurrentPage = currentPage === page;
          return (
            <Button
              key={page}
              variant={isCurrentPage ? "default" : "outline"}
              size="sm"
              onClick={handlePageChange(page)}
              disabled={disabled}
              type="button"
              className={cn(
                "min-w-[40px]",
                isCurrentPage && "pointer-events-none"
              )}
              aria-label={`Page ${page}`}
              aria-current={isCurrentPage ? "page" : undefined}
            >
              {page}
            </Button>
          );
        })}
      </div>

      {/* next page button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages || disabled}
        type="button"
        aria-label="Go to next page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {/* last page button */}
      {showFirstLastButtons && (
        <Button
          variant="outline"
          size="sm"
          onClick={handlePageChange(totalPages)}
          disabled={currentPage === totalPages || disabled}
          type="button"
          aria-label="Go to last page"
          className="hidden sm:flex"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      )}
    </nav>
  );
}
