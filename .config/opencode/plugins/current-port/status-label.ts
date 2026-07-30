export function promptStatusLabel(port: string, profile: string | undefined) {
  return profile ? `${profile}${port}` : port
}
