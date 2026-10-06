import { ChartSkeleton, Skeleton, SkeletonText } from "@/components/ui";

/** Route-level skeleton shown while a platform page's code/data streams in. */
export default function PlatformLoading() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="flex items-center gap-3" aria-hidden>
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-72 max-w-[60vw]" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-2.5 p-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3" aria-hidden>
        <div className="card p-4 lg:col-span-2">
          <ChartSkeleton height={300} />
        </div>
        <div className="card p-4">
          <SkeletonText lines={7} />
        </div>
      </div>
    </div>
  );
}
