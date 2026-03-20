export const isSessionTokenCurrent = (tokenSessionVersion: number | undefined, currentSessionVersion: unknown) => {
  const normalizedCurrentVersion = Number(currentSessionVersion ?? 0);
  return Number.isInteger(tokenSessionVersion) && tokenSessionVersion === normalizedCurrentVersion;
};