"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";

type Props = ComponentProps<"a"> & { href: string; prefetch?: boolean };

/** Exact edition documents must not inherit the prior route's streamed metadata. */
export default function CatalogLink({ href, prefetch, ...props }: Props) {
  if (/^\/(?:en\/|de\/|ru\/)?festivals\/[^/]+\/[1-9][0-9]{3}\/?$/.test(href)) {
    return <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}${href}`} {...props} />;
  }
  return <NextLink href={href} prefetch={prefetch} {...props} />;
}
