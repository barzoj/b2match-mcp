export const CLI_NAME = "b2match-mcp";

export function loginUsage(args = "<event-url>"): string {
  const suffix = args ? ` login ${args}` : " login";
  return `${CLI_NAME}${suffix} (or npx ${CLI_NAME}${suffix})`;
}
