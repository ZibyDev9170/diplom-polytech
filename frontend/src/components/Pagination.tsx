type PaginationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  ariaLabel: string;
  className?: string;
};

type PaginationItem = number | string;

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  ariaLabel,
  className,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pageItems = getVisiblePaginationItems(currentPage, totalPages);
  const rootClassName = ["users-pagination", className].filter(Boolean).join(" ");

  return (
    <nav className={rootClassName} aria-label={ariaLabel}>
      {pageItems.map((item) =>
        typeof item === "number" ? (
          <button
            aria-current={item === currentPage ? "page" : undefined}
            className={`pagination-button ${item === currentPage ? "is-active" : ""}`}
            key={item}
            onClick={() => onPageChange(item)}
            type="button"
          >
            {item}
          </button>
        ) : (
          <span className="pagination-ellipsis" key={item} aria-hidden="true">
            ...
          </span>
        ),
      )}
    </nav>
  );
}

function getVisiblePaginationItems(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  const pages = new Set<number>();

  addPageRange(pages, 1, 1, totalPages);
  addPageRange(pages, currentPage - 1, currentPage + 1, totalPages);
  addPageRange(pages, totalPages, totalPages, totalPages);

  const sortedPages = Array.from(pages).sort((first, second) => first - second);

  return sortedPages.flatMap((page, index) => {
    const previousPage = sortedPages[index - 1];

    if (previousPage && page - previousPage > 1) {
      return [`ellipsis-${previousPage}-${page}`, page];
    }

    return [page];
  });
}

function addPageRange(
  pages: Set<number>,
  fromPage: number,
  toPage: number,
  totalPages: number,
) {
  for (let page = fromPage; page <= toPage; page += 1) {
    if (page >= 1 && page <= totalPages) {
      pages.add(page);
    }
  }
}
