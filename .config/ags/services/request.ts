export function parseComponentRequest<T extends object>(
  component: string,
  argv: string[],
  res: (response: string) => void,
): T | null {
  const request = argv.join(" ");
  if (request.trim() === "") {
    res("ready");
    return null;
  }

  try {
    return JSON.parse(request) as T;
  } catch (error) {
    console.error(`Error parsing ${component} request:`, error);
    res("error: invalid JSON");
    return null;
  }
}
