/**
 * Re-mounted by Next on every navigation between platform pages → a short fade-up entrance
 * (disabled by prefers-reduced-motion). `h-full` lets full-bleed terminal routes fill <main>.
 */
export default function PlatformTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter h-full min-w-0">{children}</div>;
}
