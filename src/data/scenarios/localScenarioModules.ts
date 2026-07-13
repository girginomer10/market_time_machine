/**
 * Development-only scenario discovery. The production Vite configuration
 * aliases this module to noLocalScenarioModules so licensed local packages can
 * never be pulled into a normal release bundle by an eager glob.
 */
export const localScenarioModules = import.meta.glob<Record<string, unknown>>(
  ["./local-*/index.ts", "./sp500-covid-2020-fred/index.ts"],
  { eager: true },
);
