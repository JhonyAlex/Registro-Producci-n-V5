import fs from 'fs';

const WINDOWS_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const LINUX_CANDIDATES = [
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
];

export function chromiumCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.PUPPETEER_EXECUTABLE_PATH?.trim();
  return [
    ...(explicit ? [explicit] : []),
    ...(process.platform === 'win32' ? WINDOWS_CANDIDATES : LINUX_CANDIDATES),
  ];
}

export function detectChromiumExecutable(
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync
): string {
  const executable = chromiumCandidates(env).find(exists);
  if (!executable) {
    throw new Error(
      `No se encontró Chromium/Chrome. Configure PUPPETEER_EXECUTABLE_PATH. Rutas comprobadas: ${chromiumCandidates(env).join(', ')}`
    );
  }
  // Preserve the supplied spelling: it may be a Linux path even when this
  // command is being unit-tested from Windows.
  return executable;
}
