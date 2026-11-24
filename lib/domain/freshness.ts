export type EditionFreshness = Readonly<{
  checkedAt?: string;
  lastSuccessfulSourceCheckAt?: string;
  lastPublishedAt?: string;
  sourceCheckStale: boolean;
}>;

export type CatalogFreshness = Pick<EditionFreshness, "checkedAt" | "lastPublishedAt">;
