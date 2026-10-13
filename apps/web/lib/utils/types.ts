// Helper type to filter union types
export type FilterUnionType<T, U> = T extends U ? T : never;
