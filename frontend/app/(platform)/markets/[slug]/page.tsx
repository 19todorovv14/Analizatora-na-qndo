import type { Metadata } from "next";

import { AssetView } from "@/components/market/asset/AssetView";

function decode(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${decode(slug)} — Markets · Trading Academy` };
}

/** /markets/[slug] — asset page. `params` is a Promise in Next 16; the page itself is a client view. */
export default async function AssetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AssetView slug={decode(slug)} />;
}
