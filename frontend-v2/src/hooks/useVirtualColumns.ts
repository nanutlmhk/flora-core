import { useMemo } from "react";

export interface VirtualColumns {
  startIndex: number;
  endIndex: number;
}

export function useVirtualColumns(
  scrollLeft: number,
  viewportWidth: number,
  colWidth: number,
  totalCount: number,
  overscan = 5
): VirtualColumns {
  return useMemo(() => {
    if (viewportWidth <= 0 || totalCount <= 0) {
      return { startIndex: 0, endIndex: Math.min(totalCount - 1, 20) };
    }

    const startIndex = Math.max(
      0,
      Math.floor(scrollLeft / colWidth) - overscan
    );
    const endIndex = Math.min(
      totalCount - 1,
      Math.ceil((scrollLeft + viewportWidth) / colWidth) + overscan
    );

    return { startIndex, endIndex };
  }, [scrollLeft, viewportWidth, colWidth, totalCount, overscan]);
}
